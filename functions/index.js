const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// Safety switch. Keep true for the first deploy/log check.
// Change to false only after dryRun logs confirm the candidate count is safe.
const RETRY_DRY_RUN = false;
const SEND_ADMIN_VISIBLE_NOTIFICATION = false;
const RETRY_LOOKBACK_DAYS = 3;
const RETRY_MAX_COUNT = 100;
const RETRY_MAX_AGE_HOURS = 72;
const RETRY_MIN_INTERVAL_MS = 5 * 60 * 1000;
const ADMIN_NOTICE_MIN_AGE_MS = 10 * 60 * 1000;
const OPERATING_START_MIN = 11 * 60;
const OPERATING_END_MIN = 21 * 60 + 30;
const TOKEN_FRESHNESS_FIELDS = ["updatedAt", "lastSeenAt", "tokenUpdatedAt", "lastActive", "createdAt"];

// V2 sender app token document id. When this token exists and is valid we
// ignore any legacy main_phone token entirely.
const PREFERRED_TOKEN_DOC_ID = "main_phone_v2";

const buildAttendanceMessage = (docId, data, token) => ({
    data: {
        type: "ATTENDANCE_SMS",
        id: docId,
        studentName: data.studentName,
        attendanceType: data.type || "checkin",
        time: data.time || "",
        parentPhones: JSON.stringify(data.parentPhones || [])
    },
    android: {
        priority: "high",
        ttl: 0
    },
    token
});

const timestampMillis = (value) => {
    const date = toDateOrNull(value);
    return date ? date.getTime() : 0;
};

const tokenFreshnessMillis = (data) => {
    return Math.max(...TOKEN_FRESHNESS_FIELDS.map((field) => timestampMillis(data[field])));
};

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

const maskToken = (token) => {
    if (!token || token.length <= 14) return "***";
    return `${token.slice(0, 8)}...${token.slice(-6)}`;
};

const tokenUpdatedAfterInvalidated = (data) => {
    const invalidatedAt = timestampMillis(data.invalidatedAt);
    return invalidatedAt > 0 && tokenFreshnessMillis(data) > invalidatedAt;
};

const getAdminFcmTokenCandidates = async () => {
    const snap = await db.collection("device_tokens").get();
    const candidates = [];
    let invalidTokenCount = 0;
    let skippedInvalidButNewerTokenCount = 0;
    let tokenUpdatedAfterInvalidatedCount = 0;
    let preferredCandidate = null;
    let preferredDocPresent = false;
    let preferredDocInvalid = false;

    for (const doc of snap.docs) {
        const data = doc.data();
        const isPreferred = doc.id === PREFERRED_TOKEN_DOC_ID;
        if (isPreferred) {
            preferredDocPresent = true;
        }
        const wasInvalid = data.invalid === true;
        const refreshedAfterInvalidation = wasInvalid && tokenUpdatedAfterInvalidated(data);

        if (wasInvalid) {
            invalidTokenCount += 1;
            if (refreshedAfterInvalidation) {
                skippedInvalidButNewerTokenCount += 1;
                tokenUpdatedAfterInvalidatedCount += 1;
            } else {
                if (isPreferred) preferredDocInvalid = true;
                continue;
            }
        }
        if (!data.token || typeof data.token !== "string") {
            continue;
        }

        const candidate = {
            token: data.token,
            tokenHash: hashToken(data.token),
            maskedToken: maskToken(data.token),
            ref: doc.ref,
            source: `device_tokens/${doc.id}`,
            freshness: tokenFreshnessMillis(data),
            wasInvalid,
            refreshedAfterInvalidation,
            isPreferred
        };

        if (isPreferred) {
            preferredCandidate = candidate;
        } else {
            candidates.push(candidate);
        }
    }

    // V2 sender preferred path: if the V2 token document exists, is not invalid,
    // and carries a non-empty token, use it exclusively. Legacy main_phone tokens
    // are ignored so we never deliver to the abandoned/uninstallable old app.
    if (preferredCandidate) {
        return {
            candidates: [preferredCandidate],
            invalidTokenCount,
            skippedInvalidButNewerTokenCount,
            tokenUpdatedAfterInvalidatedCount,
            preferredDocPresent: true,
            preferredDocInvalid: false,
            usedPreferred: true
        };
    }

    candidates.sort((a, b) => b.freshness - a.freshness || a.source.localeCompare(b.source));
    return {
        candidates,
        invalidTokenCount,
        skippedInvalidButNewerTokenCount,
        tokenUpdatedAfterInvalidatedCount,
        preferredDocPresent,
        preferredDocInvalid,
        usedPreferred: false
    };
};

const getMainPhoneToken = async () => {
    const { candidates } = await getAdminFcmTokenCandidates();
    if (candidates.length === 0) {
        throw new Error("NO_VALID_ADMIN_FCM_TOKEN");
    }
    return candidates[0].token;
};

const toDateOrNull = (value) => {
    if (!value) return null;
    if (value.toDate) return value.toDate();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const dateStringDaysAgoKst = (daysAgo, now = new Date()) => {
    const d = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    d.setUTCDate(d.getUTCDate() - daysAgo);
    return d.toISOString().slice(0, 10);
};

const kstMinutesOfDay = (date) => {
    const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    return kst.getUTCHours() * 60 + kst.getUTCMinutes();
};

const isOperatingTimeKst = (date) => {
    const minutes = kstMinutesOfDay(date);
    return minutes >= OPERATING_START_MIN && minutes <= OPERATING_END_MIN;
};

const shouldRetryAttendance = (doc, now) => {
    const data = doc.data();
    if (data.processed === true) return { ok: false, reason: "already_processed" };
    if (!data.studentName) return { ok: false, reason: "missing_studentName" };
    if (data.fcmRetryStopped === true) return { ok: false, reason: "retry_stopped" };

    const cutoffDate = dateStringDaysAgoKst(RETRY_LOOKBACK_DAYS - 1, now);
    if (data.date && data.date < cutoffDate) {
        return { ok: false, reason: "outside_lookback" };
    }

    const retryCount = Number(data.fcmRetryCount || 0);
    if (retryCount >= RETRY_MAX_COUNT) {
        return { ok: false, stop: true, reason: `max_retry_count_${RETRY_MAX_COUNT}` };
    }

    const createdAt = toDateOrNull(data.timestamp) || toDateOrNull(data.createdAt);
    if (createdAt && now.getTime() - createdAt.getTime() > RETRY_MAX_AGE_HOURS * 60 * 60 * 1000) {
        return { ok: false, stop: true, reason: `max_age_${RETRY_MAX_AGE_HOURS}h` };
    }

    const lastRetryAt = toDateOrNull(data.lastFcmRetryAt);
    if (lastRetryAt && now.getTime() - lastRetryAt.getTime() < RETRY_MIN_INTERVAL_MS) {
        return { ok: false, reason: "min_interval_not_elapsed" };
    }

    return { ok: true };
};

const markRetryStopped = async (ref, reason) => {
    await ref.set({
        fcmRetryStopped: true,
        fcmRetryStopReason: reason,
        lastFcmRetryAt: FieldValue.serverTimestamp(),
        lastFcmRetryError: reason
    }, { merge: true });
};

const isInvalidFcmTokenError = (error) => {
    return error?.code === "messaging/registration-token-not-registered" ||
        error?.code === "messaging/invalid-registration-token";
};

const errorCodeOrMessage = (error) => {
    return error?.code || error?.message || String(error);
};

const markTokenInvalid = async (candidate, error) => {
    const invalidReason = errorCodeOrMessage(error);

    await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(candidate.ref);
        const currentData = snap.exists ? snap.data() : {};
        const currentToken = currentData.token;

        if (currentToken && currentToken !== candidate.token) {
            transaction.set(candidate.ref, {
                invalid: false,
                invalidatedAt: FieldValue.delete(),
                invalidReason: FieldValue.delete(),
                invalidTokenHash: FieldValue.delete(),
                invalidTokenMasked: FieldValue.delete(),
                tokenHash: hashToken(currentToken),
                maskedToken: maskToken(currentToken),
                tokenChangedDuringInvalidationAt: FieldValue.serverTimestamp(),
                previousInvalidTokenHash: candidate.tokenHash,
                previousInvalidTokenMasked: candidate.maskedToken
            }, { merge: true });
            return;
        }

        transaction.set(candidate.ref, {
            invalid: true,
            invalidatedAt: FieldValue.serverTimestamp(),
            invalidReason,
            invalidTokenHash: candidate.tokenHash,
            invalidTokenMasked: candidate.maskedToken,
            tokenHash: candidate.tokenHash,
            maskedToken: candidate.maskedToken
        }, { merge: true });
    });
};

const clearTokenInvalid = async (candidate) => {
    await candidate.ref.set({
        invalid: false,
        invalidatedAt: FieldValue.delete(),
        invalidReason: FieldValue.delete(),
        invalidTokenHash: FieldValue.delete(),
        invalidTokenMasked: FieldValue.delete(),
        tokenHash: candidate.tokenHash,
        maskedToken: candidate.maskedToken,
        lastFcmTokenSuccessAt: FieldValue.serverTimestamp()
    }, { merge: true });
};

const recordFcmFailure = async ({ ref, source, error }) => {
    await ref.set({
        lastFcmRetryAt: FieldValue.serverTimestamp(),
        lastFcmRetrySource: source,
        lastFcmRetryError: error
    }, { merge: true });
};

const sendOrDryRunFcm = async ({ ref, docId, data, tokenCandidates, source, dryRun }) => {
    const updateBase = {
        lastFcmRetryAt: FieldValue.serverTimestamp(),
        lastFcmRetrySource: source,
        fcmRetryDryRun: dryRun
    };

    if (tokenCandidates.length === 0) {
        await recordFcmFailure({
            ref,
            source,
            error: "NO_VALID_ADMIN_FCM_TOKEN"
        });
        return {
            sent: false,
            dryRun: false,
            selectedTokenSource: null,
            error: "NO_VALID_ADMIN_FCM_TOKEN"
        };
    }

    if (dryRun) {
        const selected = tokenCandidates[0];
        const message = buildAttendanceMessage(docId, data, selected.token);
        console.log(`[DRY_RUN] Would send FCM for attendance/${docId}`, message.data);
        return {
            sent: false,
            dryRun: true,
            selectedTokenSource: selected.source
        };
    }

    let lastError = null;
    for (const candidate of tokenCandidates) {
        if (candidate.invalidated === true) continue;
        const message = buildAttendanceMessage(docId, data, candidate.token);
        try {
            const response = await admin.messaging().send(message);
            await clearTokenInvalid(candidate);
            await ref.set({
                ...updateBase,
                firstFcmSentAt: data.firstFcmSentAt || FieldValue.serverTimestamp(),
                lastFcmSentAt: FieldValue.serverTimestamp(),
                fcmRetryCount: FieldValue.increment(1),
                fcmRetryStopped: false,
                fcmRetryStopReason: null,
                lastFcmRetryError: null,
                lastFcmResponse: response,
                lastFcmTokenSource: candidate.source
            }, { merge: true });
            return { sent: true, response, selectedTokenSource: candidate.source };
        } catch (error) {
            lastError = error;
            console.error(`[FCM] failed token ${candidate.source}:`, errorCodeOrMessage(error));
            if (isInvalidFcmTokenError(error)) {
                candidate.invalidated = true;
                await markTokenInvalid(candidate, error);
            }
        }
    }

    const failure = errorCodeOrMessage(lastError) || "NO_VALID_ADMIN_FCM_TOKEN";
    await recordFcmFailure({ ref, source, error: failure });
    return {
        sent: false,
        dryRun: false,
        selectedTokenSource: null,
        error: failure
    };
};

const maybeSendAdminVisibleNotification = async ({ docId, data, tokenCandidates, now }) => {
    if (!SEND_ADMIN_VISIBLE_NOTIFICATION) return { sent: false, reason: "disabled" };
    const createdAt = toDateOrNull(data.timestamp) || toDateOrNull(data.createdAt);
    if (!createdAt || now.getTime() - createdAt.getTime() < ADMIN_NOTICE_MIN_AGE_MS) {
        return { sent: false, reason: "not_old_enough" };
    }

    const result = await sendOrDryRunNotice({
        docId,
        tokenCandidates,
        notification: {
            title: "미발송 출결 문자 있음",
            body: "앱을 열면 밀린 문자가 전송됩니다"
        }
    });
    return result;
};

const sendOrDryRunNotice = async ({ docId, tokenCandidates, notification }) => {
    for (const candidate of tokenCandidates) {
        if (candidate.invalidated === true) continue;
        try {
            await admin.messaging().send({
                token: candidate.token,
                notification,
                android: {
                    priority: "high"
                },
                data: {
                    type: "PENDING_ATTENDANCE_SMS_NOTICE",
                    id: docId
                }
            });
            return { sent: true, selectedTokenSource: candidate.source };
        } catch (error) {
            if (isInvalidFcmTokenError(error)) {
                candidate.invalidated = true;
                await markTokenInvalid(candidate, error);
            }
        }
    }
    return { sent: false, reason: "all_notice_tokens_failed" };
};

/**
 * attendance 컬렉션에 새 문서가 생기면 실행됨 (FCM 알림 전송)
 */
exports.sendAttendanceFcm = onDocumentCreated("attendance/{docId}", async (event) => {
    const snapshot = event.data;
    if (!snapshot) return null;

    const data = snapshot.data();
    if (data.processed || !data.studentName) return null;

    try {
        const {
            candidates,
            invalidTokenCount,
            skippedInvalidButNewerTokenCount,
            tokenUpdatedAfterInvalidatedCount,
            preferredDocPresent,
            preferredDocInvalid,
            usedPreferred
        } = await getAdminFcmTokenCandidates();
        const result = await sendOrDryRunFcm({
            ref: snapshot.ref,
            docId: event.params.docId,
            data,
            tokenCandidates: candidates,
            source: "onCreate",
            dryRun: false
        });

        console.log("[sendAttendanceFcm] result", {
            studentName: data.studentName,
            selectedTokenSource: result.selectedTokenSource,
            usedPreferred,
            preferredDocPresent,
            preferredDocInvalid,
            preferredTokenDocId: PREFERRED_TOKEN_DOC_ID,
            tokenCandidateCount: candidates.length,
            invalidTokenCount,
            skippedInvalidButNewerTokenCount,
            tokenUpdatedAfterInvalidatedCount,
            sent: result.sent,
            failed: result.sent ? 0 : 1,
            error: result.error || null
        });
        return result.response || null;

    } catch (error) {
        console.error("Error sending FCM:", error);
        await snapshot.ref.set({
            lastFcmRetryAt: FieldValue.serverTimestamp(),
            lastFcmRetrySource: "onCreate",
            lastFcmRetryError: error.message || String(error)
        }, { merge: true });
        return null;
    }
});

/**
 * Scheduled fallback:
 * Long-idle admin phones can miss a one-shot FCM. This retry scans recent
 * processed:false attendance documents and resends the exact same data payload
 * the existing Android FcmService already understands.
 */
exports.retryPendingAttendanceFcm = onSchedule(
    {
        schedule: "every 5 minutes",
        timeZone: "Asia/Seoul",
        region: "us-central1"
    },
    async () => {
        const now = new Date();
        const dryRun = RETRY_DRY_RUN;
        const cutoffDate = dateStringDaysAgoKst(RETRY_LOOKBACK_DAYS - 1, now);
        if (!isOperatingTimeKst(now)) {
            console.log("[retryPendingAttendanceFcm] skip outside operating hours", {
                dryRun,
                operatingHoursKst: "11:00-21:30"
            });
            return null;
        }

        console.log(`[retryPendingAttendanceFcm] start dryRun=${dryRun} cutoffDate=${cutoffDate} intervalMs=${RETRY_MIN_INTERVAL_MS}`);

        const {
            candidates: tokenCandidates,
            invalidTokenCount,
            skippedInvalidButNewerTokenCount,
            tokenUpdatedAfterInvalidatedCount,
            preferredDocPresent,
            preferredDocInvalid,
            usedPreferred
        } = await getAdminFcmTokenCandidates();
        const defaultSelectedTokenSource = tokenCandidates[0]?.source || null;

        const snap = await db.collection("attendance")
            .where("processed", "==", false)
            .get();

        let scanned = 0;
        let eligible = 0;
        let sent = 0;
        let dryRunCount = 0;
        let stopped = 0;
        let skipped = 0;
        let adminNoticeSent = 0;
        let failed = 0;
        const selectedTokenSources = new Set();

        for (const doc of snap.docs) {
            scanned += 1;
            const freshDoc = await doc.ref.get();
            if (!freshDoc.exists) {
                skipped += 1;
                continue;
            }

            const data = freshDoc.data();
            if (data.processed === true) {
                skipped += 1;
                continue;
            }

            const decision = shouldRetryAttendance(freshDoc, now);

            if (decision.stop) {
                stopped += 1;
                await markRetryStopped(doc.ref, decision.reason);
                console.warn(`[retryPendingAttendanceFcm] stopped attendance/${doc.id}: ${decision.reason}`);
                continue;
            }

            if (!decision.ok) {
                skipped += 1;
                continue;
            }

            eligible += 1;
            try {
                const result = await sendOrDryRunFcm({
                    ref: doc.ref,
                    docId: doc.id,
                    data,
                    tokenCandidates,
                    source: "scheduledRetry",
                    dryRun
                });
                if (result.dryRun) dryRunCount += 1;
                if (result.sent) sent += 1;
                if (!result.sent && !result.dryRun) failed += 1;
                if (result.selectedTokenSource) selectedTokenSources.add(result.selectedTokenSource);
                console.log(`[retryPendingAttendanceFcm] ${result.dryRun ? "dryRun" : result.sent ? "sent" : "failed"} attendance/${doc.id}`, {
                    selectedTokenSource: result.selectedTokenSource,
                    error: result.error || null
                });

                if (!dryRun) {
                    const notice = await maybeSendAdminVisibleNotification({
                        docId: doc.id,
                        data,
                        tokenCandidates,
                        now
                    });
                    if (notice.sent) adminNoticeSent += 1;
                }
            } catch (error) {
                failed += 1;
                console.error(`[retryPendingAttendanceFcm] failed attendance/${doc.id}:`, error);
                await doc.ref.set({
                    lastFcmRetryAt: FieldValue.serverTimestamp(),
                    lastFcmRetrySource: "scheduledRetry",
                    lastFcmRetryError: error.message || String(error)
                }, { merge: true });
            }
        }

        console.log("[retryPendingAttendanceFcm] summary", {
            scanned,
            eligible,
            selectedTokenSource: [...selectedTokenSources][0] || defaultSelectedTokenSource,
            selectedTokenSources: [...selectedTokenSources],
            usedPreferred,
            preferredDocPresent,
            preferredDocInvalid,
            preferredTokenDocId: PREFERRED_TOKEN_DOC_ID,
            tokenCandidateCount: tokenCandidates.length,
            invalidTokenCount,
            skippedInvalidButNewerTokenCount,
            tokenUpdatedAfterInvalidatedCount,
            sent,
            dryRunCount,
            stopped,
            skipped,
            adminNoticeSent,
            failed
        });

        return null;
    }
);
