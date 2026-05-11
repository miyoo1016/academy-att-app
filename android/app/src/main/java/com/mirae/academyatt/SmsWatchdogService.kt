package com.mirae.academyatt

import android.app.*
import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import android.telephony.SmsManager
import androidx.core.content.ContextCompat
import androidx.core.app.NotificationCompat
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.time.LocalDate
import org.json.JSONObject
import org.json.JSONArray
import java.time.Instant

/**
 * SmsWatchdogService - 경량화된 포그라운드 서비스
 * 
 * 이제 실시간 감시는 FCM(구글 제공)이 전담하므로,
 * 이 서비스는 프로세스가 시스템에 의해 우선순위에서 밀려 종료되는 것을 방지하는
 * 최소한의 Foreground Service 역할만 수행합니다.
 */
class SmsWatchdogService : Service() {

    companion object {
        const val TAG = "SmsWatchdog"
        private const val CHANNEL_ID = "academy_watchdog_channel"
        private const val NOTIFICATION_ID = 9999
        const val FIREBASE_PROJECT_ID = "attmirae"
        const val API_KEY = "AIzaSyCFwvKTiJj8EM9u2zp3RqLP4TFq0XtDYCs"
        private const val LOOKBACK_DAYS = 3L
        private const val CLAIM_STALE_MS = 5 * 60 * 1000L
        const val DEVICE_ID = "main_phone_android"

        fun start(context: Context, source: String = "watchdog") {
            try {
                val intent = Intent(context, SmsWatchdogService::class.java).apply {
                    putExtra("source", source)
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Watchdog 시작 실패: ${e.message}")
                writeWatchdogStatus(
                    context,
                    "start_failed",
                    lastError = "${e.javaClass.simpleName}: ${e.message}"
                )
            }
        }

        fun processPendingNow(context: Context, source: String = "watchdog") {
            Thread {
                SmsWatchdogService().processPendingMessages(context.applicationContext, source)
            }.start()
        }

        fun buildAttendanceMessage(studentName: String, type: String, time: String): String {
            return if (type == "checkin") {
                "[미래학원] $time $studentName 원생이 등원하였습니다. 최선을 다해 지도하겠습니다."
            } else {
                "[미래학원] $time $studentName 원생이 공부를 마치고 귀가할 예정입니다."
            }
        }

        fun markSuccess(docId: String, source: String) {
            val now = Instant.now().toString()
            val urlString = "https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents/attendance/$docId" +
                "?updateMask.fieldPaths=processed&updateMask.fieldPaths=sending&updateMask.fieldPaths=sentAt&updateMask.fieldPaths=sentByDevice&updateMask.fieldPaths=sendSource&updateMask.fieldPaths=lastError&key=$API_KEY"
            val body = """
                {"fields":{
                    "processed":{"booleanValue":true},
                    "sending":{"booleanValue":false},
                    "sentAt":{"timestampValue":"$now"},
                    "sentByDevice":{"stringValue":"$DEVICE_ID"},
                    "sendSource":{"stringValue":"$source"},
                    "lastError":{"nullValue":null}
                }}
            """.trimIndent()
            patchJson(urlString, body)
        }

        fun markFailure(docId: String, retryCount: Int, error: String) {
            val now = Instant.now().toString()
            val safeError = JSONObject.quote(error.take(500))
            val urlString = "https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents/attendance/$docId" +
                "?updateMask.fieldPaths=processed&updateMask.fieldPaths=sending&updateMask.fieldPaths=retryCount&updateMask.fieldPaths=lastError&updateMask.fieldPaths=lastAttemptAt&key=$API_KEY"
            val body = """
                {"fields":{
                    "processed":{"booleanValue":false},
                    "sending":{"booleanValue":false},
                    "retryCount":{"integerValue":"$retryCount"},
                    "lastError":{"stringValue":$safeError},
                    "lastAttemptAt":{"timestampValue":"$now"}
                }}
            """.trimIndent()
            patchJson(urlString, body)
        }

        fun writeWatchdogStatus(
            context: Context,
            result: String,
            startedAt: String? = null,
            finishedAt: String? = null,
            processedQueueCount: Int? = null,
            claimedCount: Int? = null,
            successCount: Int? = null,
            failureCount: Int? = null,
            lastError: String? = null,
            lastSmsSuccessAt: String? = null
        ) {
            Thread {
                try {
                    val fields = JSONObject()
                    fields.put("updatedAt", JSONObject().put("timestampValue", Instant.now().toString()))
                    fields.put("lastWatchdogResult", JSONObject().put("stringValue", result))
                    startedAt?.let { fields.put("lastWatchdogStartedAt", JSONObject().put("timestampValue", it)) }
                    finishedAt?.let { fields.put("lastWatchdogFinishedAt", JSONObject().put("timestampValue", it)) }
                    processedQueueCount?.let { fields.put("processedQueueCount", JSONObject().put("integerValue", it.toString())) }
                    claimedCount?.let { fields.put("claimedCount", JSONObject().put("integerValue", it.toString())) }
                    successCount?.let { fields.put("successCount", JSONObject().put("integerValue", it.toString())) }
                    failureCount?.let { fields.put("failureCount", JSONObject().put("integerValue", it.toString())) }
                    lastError?.let { fields.put("lastError", JSONObject().put("stringValue", it.take(500))) }
                    lastSmsSuccessAt?.let { fields.put("lastSmsSuccessAt", JSONObject().put("timestampValue", it)) }
                    val masks = fields.keys().asSequence().joinToString("") { "&updateMask.fieldPaths=$it" }
                    val body = JSONObject().put("fields", fields).toString()
                    patchJson("https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents/watchdogStatus/main_terminal?$masks&key=$API_KEY", body)
                    HeartbeatModule.pingHeartbeat(context)
                } catch (e: Exception) {
                    Log.e(TAG, "watchdogStatus 기록 실패: ${e.message}")
                }
            }.start()
        }

        fun patchJson(urlString: String, body: String): Int {
            val conn = (URL(urlString).openConnection() as HttpURLConnection).apply {
                requestMethod = "PATCH"
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
            conn.outputStream.use { it.write(body.toByteArray()) }
            val responseCode = conn.responseCode
            if (responseCode !in 200..299) {
                val err = conn.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
                Log.w(TAG, "Firestore PATCH 실패 $responseCode: $err")
            }
            conn.disconnect()
            return responseCode
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification())

        // 최소한의 WakeLock 유지 (시스템이 CPU를 완전히 끄지 않도록)
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "AcademyWatchdog::WakeLock"
        ).apply {
            setReferenceCounted(false)
            acquire(24 * 60 * 60 * 1000L)
        }
        
        Log.d(TAG, "Watchdog 가동 중 (FCM 하이브리드 모드)")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // [네이티브 통합] 시작/재시작되는 모든 순간 미발송분을 즉시 재처리합니다.
        val source = intent?.getStringExtra("source") ?: "watchdog"
        sendHeartbeatNative()
        processPendingNow(applicationContext, source)
        return START_STICKY
    }

    private fun sendHeartbeatNative() {
        Thread {
            try {
                Log.d(TAG, "📡 [네이티브] 하트비트 전송...")
                val urlString = "https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents/service_status/main_terminal?updateMask.fieldPaths=lastActive&updateMask.fieldPaths=status&updateMask.fieldPaths=platform&key=$API_KEY"
                val url = URL(urlString)
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "PATCH"
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                
                // Firestore REST API 특성상 정확한 구조가 필요함
                val body = """
                    {
                        "fields": {
	                            "lastActive": {"timestampValue": "${Instant.now()}"},
	                            "status": {"stringValue": "running_native_only"},
	                            "platform": {"stringValue": "android"}
                        }
                    }
                """.trimIndent()
                
                conn.outputStream.use { it.write(body.toByteArray()) }
                Log.d(TAG, "📡 하트비트 완료 (Status: ${conn.responseCode})")
                conn.disconnect()
                
                // 네이티브 하트비트 저장 (SmsAlarmReceiver 확인용)
                HeartbeatModule.pingHeartbeat(applicationContext)
            } catch (e: Exception) {
                Log.e(TAG, "❌ 하트비트 오류: ${e.message}")
            }
        }.start()
    }

    private fun processPendingMessages(context: Context, source: String) {
        val startedAt = Instant.now().toString()
        var queueCount = 0
        var claimedCount = 0
        var failureCount = 0
        var lastError: String? = null
        try {
            Log.d(TAG, "🔍 미발송 재처리 시작: source=$source")
            HeartbeatModule.pingHeartbeat(context)
            writeWatchdogStatus(context, "started:$source", startedAt = startedAt)
            val docs = fetchPendingAttendance()
            queueCount = docs.size
            updateServiceStatus(context, source, pendingCount = docs.size)

            for (doc in docs) {
                val fields = doc.optJSONObject("fields") ?: continue
                val docId = doc.getString("name").split("/").last()
                if (!isRecentEnough(fields)) continue
                val isStale = isStaleClaim(fields)
                if (!isClaimAvailable(fields)) continue
                val previousClaimedBy = stringField(fields, "claimedBy", "")
                if (!claimAttendance(docId, doc.optString("updateTime"), source, isStale, previousClaimedBy)) continue
                claimedCount++

                try {
                    val studentName = stringField(fields, "studentName", "학생")
                    val type = stringField(fields, "type", "checkin")
                    val time = stringField(fields, "time", "")
                    val phones = phoneList(fields)
                    val retryCount = intField(fields, "retryCount", 0)

                    if (phones.isEmpty()) {
                        throw IllegalStateException("등록된 학부모 연락처 없음")
                    }

                    val expectedResults = sendSmsToAll(
                        context,
                        docId,
                        source,
                        retryCount,
                        phones,
                        buildAttendanceMessage(studentName, type, time)
                    )
                    Log.i(TAG, "📨 SMS 발송 요청 완료, 결과 대기: $studentName ($docId), resultIntents=$expectedResults")
                } catch (e: Exception) {
                    val retryCount = intField(fields, "retryCount", 0)
                    failureCount++
                    lastError = "${e.javaClass.simpleName}: ${e.message}"
                    markFailure(docId, retryCount + 1, e.message ?: e.toString())
                    updateServiceStatus(context, source, lastError = e.message ?: e.toString())
                    Log.e(TAG, "❌ 미발송 재처리 실패: $docId / ${e.message}")
                }
            }
            writeWatchdogStatus(
                context,
                if (failureCount > 0) "finished_with_failures:$source" else "finished:$source",
                startedAt = startedAt,
                finishedAt = Instant.now().toString(),
                processedQueueCount = queueCount,
                claimedCount = claimedCount,
                successCount = 0,
                failureCount = failureCount,
                lastError = lastError
            )
        } catch (e: Exception) {
            lastError = "${e.javaClass.simpleName}: ${e.message}"
            updateServiceStatus(context, source, lastError = e.message ?: e.toString())
            writeWatchdogStatus(
                context,
                "failed:$source",
                startedAt = startedAt,
                finishedAt = Instant.now().toString(),
                processedQueueCount = queueCount,
                claimedCount = claimedCount,
                successCount = 0,
                failureCount = failureCount + 1,
                lastError = lastError
            )
            Log.e(TAG, "❌ 미발송 재처리 전체 오류: ${e.message}")
        }
    }

    private fun fetchPendingAttendance(): List<JSONObject> {
        val urlString = "https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents:runQuery?key=$API_KEY"
        val queryJson = """
            {
                "structuredQuery": {
                    "from": [{"collectionId": "attendance"}],
                    "where": {
                        "fieldFilter": {
                            "field": {"fieldPath": "processed"},
                            "op": "EQUAL",
                            "value": {"booleanValue": false}
                        }
                    }
                }
            }
        """.trimIndent()
        val response = postJson(urlString, queryJson)
        val results = JSONArray(response)
        val docs = mutableListOf<JSONObject>()
        for (i in 0 until results.length()) {
            results.optJSONObject(i)?.optJSONObject("document")?.let { docs.add(it) }
        }
        return docs
    }

    private fun claimAttendance(
        docId: String,
        updateTime: String,
        source: String,
        isStale: Boolean,
        previousClaimedBy: String
    ): Boolean {
        val now = Instant.now().toString()
        val encodedUpdateTime = URLEncoder.encode(updateTime, "UTF-8")
        val fields = JSONObject()
        fields.put("sending", JSONObject().put("booleanValue", true))
        fields.put("claimedAt", JSONObject().put("timestampValue", now))
        fields.put("claimedBy", JSONObject().put("stringValue", DEVICE_ID))
        fields.put("sendSource", JSONObject().put("stringValue", source))
        if (isStale) {
            fields.put("staleRecoveredAt", JSONObject().put("timestampValue", now))
            fields.put("previousClaimedBy", JSONObject().put("stringValue", previousClaimedBy))
        }
        val masks = fields.keys().asSequence().joinToString("") { "&updateMask.fieldPaths=$it" }
        val urlString = "https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents/attendance/$docId" +
            "?$masks&currentDocument.updateTime=$encodedUpdateTime&key=$API_KEY"
        val body = JSONObject().put("fields", fields).toString()
        return patchJson(urlString, body) in 200..299
    }

    private fun updateServiceStatus(
        context: Context,
        source: String,
        pendingCount: Int? = null,
        lastSmsSuccessAt: String? = null,
        lastError: String? = null
    ) {
        val now = Instant.now().toString()
        val fields = JSONObject()
        fields.put("lastActive", JSONObject().put("timestampValue", now))
        fields.put("watchdogLastRun", JSONObject().put("timestampValue", now))
        fields.put("status", JSONObject().put("stringValue", "running_native_queue"))
        fields.put("platform", JSONObject().put("stringValue", "android"))
        fields.put("lastRunSource", JSONObject().put("stringValue", source))
        pendingCount?.let { fields.put("pendingCount", JSONObject().put("integerValue", it.toString())) }
        lastSmsSuccessAt?.let { fields.put("lastSmsSuccessAt", JSONObject().put("timestampValue", it)) }
        lastError?.let { fields.put("lastError", JSONObject().put("stringValue", it.take(500))) }

        val masks = fields.keys().asSequence().joinToString("") { "&updateMask.fieldPaths=$it" }
        val urlString = "https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents/service_status/main_terminal?$masks&key=$API_KEY"
        patchJson(urlString, JSONObject().put("fields", fields).toString())
        HeartbeatModule.pingHeartbeat(context)
    }

    private fun isRecentEnough(fields: JSONObject): Boolean {
        val cutoff = LocalDate.now().minusDays(LOOKBACK_DAYS - 1).toString()
        val date = stringField(fields, "date", "")
        return date.isBlank() || date >= cutoff
    }

    private fun isClaimAvailable(fields: JSONObject): Boolean {
        val sending = fields.optJSONObject("sending")?.optBoolean("booleanValue") == true
        if (!sending) return true
        return isStaleClaim(fields)
    }

    private fun isStaleClaim(fields: JSONObject): Boolean {
        val claimedAt = fields.optJSONObject("claimedAt")?.optString("timestampValue") ?: return true
        val claimedMs = runCatching { Instant.parse(claimedAt).toEpochMilli() }.getOrDefault(0L)
        return System.currentTimeMillis() - claimedMs > CLAIM_STALE_MS
    }

    private fun sendSmsToAll(
        context: Context,
        docId: String,
        source: String,
        retryCount: Int,
        phones: List<String>,
        message: String
    ): Int {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
            throw SecurityException("SMS 권한 없음")
        }
        val smsManager: SmsManager = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(SmsManager::class.java)
        } else {
            @Suppress("DEPRECATION")
            SmsManager.getDefault()
        } ?: throw IllegalStateException("SmsManager 사용 불가")

        val cleanPhones = phones.map { it.replace(Regex("[^0-9]"), "") }.filter { it.isNotBlank() }
        if (cleanPhones.isEmpty()) throw IllegalStateException("유효한 전화번호 없음")
        val partsPerPhone = cleanPhones.map { smsManager.divideMessage(message).size.coerceAtLeast(1) }
        val expectedResults = partsPerPhone.sum()
        SmsSentReceiver.prepare(context, docId, source, retryCount, expectedResults)

        var requestIndex = 0
        for (cleanPhone in cleanPhones) {
            val parts = smsManager.divideMessage(message)
            if (parts.size > 1) {
                val intents = ArrayList<PendingIntent>()
                for (partIndex in parts.indices) {
                    intents.add(SmsSentReceiver.pendingIntent(context, docId, source, retryCount, expectedResults, requestIndex++))
                }
                smsManager.sendMultipartTextMessage(cleanPhone, null, parts, intents, null)
            } else {
                smsManager.sendTextMessage(
                    cleanPhone,
                    null,
                    message,
                    SmsSentReceiver.pendingIntent(context, docId, source, retryCount, expectedResults, requestIndex++),
                    null
                )
            }
        }
        return expectedResults
    }

    private fun phoneList(fields: JSONObject): List<String> {
        val values = fields.optJSONObject("parentPhones")
            ?.optJSONObject("arrayValue")
            ?.optJSONArray("values") ?: return emptyList()
        val phones = mutableListOf<String>()
        for (i in 0 until values.length()) {
            values.optJSONObject(i)?.optString("stringValue")?.takeIf { it.isNotBlank() }?.let { phones.add(it) }
        }
        return phones
    }

    private fun stringField(fields: JSONObject, name: String, fallback: String): String {
        return fields.optJSONObject(name)?.optString("stringValue") ?: fallback
    }

    private fun intField(fields: JSONObject, name: String, fallback: Int): Int {
        return fields.optJSONObject(name)?.optString("integerValue")?.toIntOrNull() ?: fallback
    }

    private fun postJson(urlString: String, body: String): String {
        val conn = (URL(urlString).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
        }
        conn.outputStream.use { it.write(body.toByteArray()) }
        val response = if (conn.responseCode in 200..299) {
            conn.inputStream.bufferedReader().use { it.readText() }
        } else {
            val err = conn.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
            throw IllegalStateException("Firestore POST 실패 ${conn.responseCode}: $err")
        }
        conn.disconnect()
        return response
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "출결 시스템 유지 보수",
                NotificationManager.IMPORTANCE_MIN
            ).apply {
                description = "안정적인 출결 메시지 전송을 보장합니다"
                setShowBadge(false)
                setSound(null, null)
            }
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("실시간 출결 감시 서비스 가동 중")
            .setContentText("안정적인 메시지 전송 상태를 유지하고 있습니다")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setPriority(NotificationCompat.PRIORITY_LOW) // MIN 대신 LOW로 해서 상단바에 확실히 유지
            .setSilent(true)
            .setOngoing(true)
            .build()
    }

    override fun onDestroy() {
        super.onDestroy()
        try {
            if (wakeLock?.isHeld == true) wakeLock?.release()
        } catch (e: Exception) {}
        
        // 종료 시 재시작 시도
        start(applicationContext)
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
