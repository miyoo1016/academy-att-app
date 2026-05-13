package com.mirae.academyatt.sender2

import android.content.Context
import android.telephony.SmsManager
import android.util.Log
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.tasks.await
import org.json.JSONArray

/**
 * Shared SMS dispatch logic used by both FCM push handling and the in-app
 * polling sweep.
 *
 * Safety invariants enforced here (must never be removed):
 *   1. Re-read the attendance document inside a Firestore transaction
 *      immediately before sending. If processed==true we abort.
 *   2. Mark processed=true ONLY after at least one SmsManager.sendTextMessage
 *      returns without throwing.
 *   3. If SMS send throws for every parent number, we leave processed=false
 *      so the scheduled retry path can pick it up next round.
 */
object AttendanceDispatcher {

    private const val TAG = "AttendanceDispatcher"

    data class AttendanceFields(
        val docId: String,
        val studentName: String,
        val attendanceType: String,
        val time: String,
        val parentPhones: List<String>
    )

    /**
     * Build the canonical SMS body. The wording MUST match the legacy
     * smsUtils.js output verbatim — parents already rely on this format.
     */
    fun buildMessage(fields: AttendanceFields): String {
        val time = fields.time
        val name = fields.studentName
        return if (fields.attendanceType == "checkin") {
            "[미래학원] $time $name 원생이 등원하였습니다. 최선을 다해 지도하겠습니다."
        } else {
            "[미래학원] $time $name 원생이 공부를 마치고 귀가할 예정입니다."
        }
    }

    /**
     * Atomic claim: read processed, if false set true, otherwise abort.
     * Returns true if THIS caller owns the send.
     */
    private suspend fun claimAttendance(docId: String): Boolean {
        val ref = FirebaseFirestore.getInstance()
            .collection("attendance").document(docId)
        return try {
            FirebaseFirestore.getInstance().runTransaction { tx ->
                val snap = tx.get(ref)
                if (!snap.exists()) return@runTransaction false
                val processed = snap.getBoolean("processed") ?: false
                if (processed) return@runTransaction false
                tx.update(
                    ref,
                    mapOf(
                        "processed" to true,
                        "processedAt" to com.google.firebase.firestore.FieldValue.serverTimestamp(),
                        "processedBy" to "sender_v2"
                    )
                )
                true
            }.await()
        } catch (e: Exception) {
            Log.e(TAG, "claimAttendance failed for $docId: ${e.message}")
            false
        }
    }

    /**
     * Revert processed=true if every SmsManager call failed. Without this
     * the queue would be permanently stuck.
     */
    private suspend fun releaseClaim(docId: String, reason: String) {
        try {
            FirebaseFirestore.getInstance()
                .collection("attendance").document(docId)
                .update(
                    mapOf(
                        "processed" to false,
                        "lastSendFailureReason" to reason,
                        "lastSendFailureAt" to com.google.firebase.firestore.FieldValue.serverTimestamp()
                    )
                ).await()
        } catch (e: Exception) {
            Log.e(TAG, "releaseClaim failed for $docId: ${e.message}")
        }
    }

    /**
     * Core entry point. Returns true if SMS went out to at least one parent.
     *
     * @param context  Application context (for SmsManager + StatusStore)
     * @param fields   Parsed attendance fields. parentPhones MUST be non-empty
     *                 for any SMS to be sent.
     */
    suspend fun dispatch(context: Context, fields: AttendanceFields): Boolean {
        if (fields.parentPhones.isEmpty()) {
            Log.w(TAG, "No parent phones for ${fields.studentName}; skip")
            return false
        }

        // Atomic Firestore claim. If somebody else (another retry, the legacy
        // service, or the JS path) already processed this, we bail out.
        val claimed = claimAttendance(fields.docId)
        if (!claimed) {
            Log.i(TAG, "Skip ${fields.docId} — already processed by another sender")
            return false
        }

        val message = buildMessage(fields)
        val sms: SmsManager = getSmsManager(context)
        var anySuccess = false
        var lastError: String? = null

        for (phone in fields.parentPhones) {
            if (phone.isBlank()) continue
            try {
                val normalised = phone.trim()
                val parts = sms.divideMessage(message)
                if (parts.size == 1) {
                    sms.sendTextMessage(normalised, null, message, null, null)
                } else {
                    sms.sendMultipartTextMessage(normalised, null, parts, null, null)
                }
                anySuccess = true
                Log.i(TAG, "SMS sent to $normalised for ${fields.studentName}")
            } catch (e: Exception) {
                lastError = e.message
                Log.e(TAG, "SMS failed to $phone: ${e.message}")
            }
        }

        if (anySuccess) {
            StatusStore.recordSmsSuccess(
                context,
                "${fields.studentName} (${if (fields.attendanceType == "checkin") "등원" else "귀가"})"
            )
            return true
        }

        // Every recipient failed — undo claim so retry path can re-try later.
        releaseClaim(fields.docId, lastError ?: "all_sms_failed")
        StatusStore.recordSmsFailure(
            context,
            fields.studentName,
            lastError ?: "all_sms_failed"
        )
        return false
    }

    /**
     * API 31+ requires per-context SmsManager; older builds use the
     * (deprecated) singleton.
     */
    @Suppress("DEPRECATION")
    private fun getSmsManager(context: Context): SmsManager {
        return if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
            context.getSystemService(SmsManager::class.java)
        } else {
            SmsManager.getDefault()
        }
    }

    /**
     * Parses the FCM data payload our existing Cloud Function emits. Must
     * remain backward-compatible with the original schema.
     */
    fun parseFromFcm(data: Map<String, String>): AttendanceFields? {
        val docId = data["id"] ?: return null
        val studentName = data["studentName"] ?: return null
        val attendanceType = data["attendanceType"] ?: "checkin"
        val time = data["time"] ?: ""
        val phonesJson = data["parentPhones"] ?: "[]"
        val phones = parsePhones(phonesJson)
        return AttendanceFields(docId, studentName, attendanceType, time, phones)
    }

    private fun parsePhones(json: String): List<String> {
        return try {
            val arr = JSONArray(json)
            (0 until arr.length()).mapNotNull { arr.optString(it).takeIf { s -> s.isNotBlank() } }
        } catch (e: Exception) {
            Log.e(TAG, "parsePhones failed: ${e.message}")
            emptyList()
        }
    }
}
