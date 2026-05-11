package com.mirae.academyatt

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant

/**
 * FcmService - Firebase Cloud Messaging 수신 핸들러 (네이티브)
 *
 * 이 서비스는 JS(React Native) 레이어가 멈춰있어도 Android 시스템에 의해 깨어나 실행됩니다.
 * 서버(Cloud Functions)로부터 data 메시지를 받으면 즉시 SmsManager를 통해 문자를 발송합니다.
 */
class FcmService : FirebaseMessagingService() {

    companion object {
        private const val TAG = "AcademyFcmService"
        private const val FIREBASE_PROJECT_ID = "attmirae"
        private const val API_KEY = "AIzaSyCFwvKTiJj8EM9u2zp3RqLP4TFq0XtDYCs"
    }

    /**
     * FCM 메시지 수신 시 호출됨
     */
    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)
        Log.d(TAG, "FCM 메시 수신: from=${remoteMessage.from}")
        SmsWatchdogService.writeWatchdogStatus(applicationContext, "fcm_received")
        SmsWatchdogService.start(applicationContext, "fcm")
        SmsWatchdogService.processPendingNow(applicationContext, "fcm")

        // 1. Data 페이로드 확인
        if (remoteMessage.data.isNotEmpty()) {
            val type = remoteMessage.data["type"]
            Log.d(TAG, "메시지 데이터 수신: type=$type")

            if (type == "ATTENDANCE_SMS") {
                handleAttendanceSms(remoteMessage.data)
                SmsWatchdogService.processPendingNow(applicationContext, "fcm_after")
            }
        }
    }

    /**
     * 출석 SMS 발송 처리
     */
    private fun handleAttendanceSms(data: Map<String, String>) {
        val studentName = data["studentName"] ?: "학생"
        val attendanceType = data["attendanceType"] ?: "checkin"
        Log.i(TAG, "FCM 출결 수신: $studentName (${if(attendanceType=="checkin") "등원" else "귀가"})")
        // 실제 SMS 발송은 Watchdog 큐 처리기로 통일합니다.
        // processed:false 문서를 claim한 뒤 발송하므로 FCM/알람/앱복귀 경로가 겹쳐도 중복 발송을 피합니다.
    }

    private fun registerToken(token: String) {
        Thread {
            try {
                val now = Instant.now().toString()
                val urlString = "https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents/device_tokens/main_phone?updateMask.fieldPaths=token&updateMask.fieldPaths=platform&updateMask.fieldPaths=updatedAt&updateMask.fieldPaths=lastActive&updateMask.fieldPaths=source&key=$API_KEY"
                val url = URL(urlString)
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "PATCH"
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")

                val body = """
                    {
                        "fields": {
                            "token": {"stringValue": "$token"},
                            "platform": {"stringValue": "android"},
                            "updatedAt": {"timestampValue": "$now"},
                            "lastActive": {"timestampValue": "$now"},
                            "source": {"stringValue": "native_fcm"}
                        }
                    }
                """.trimIndent()

                conn.outputStream.use { it.write(body.toByteArray()) }
                Log.i(TAG, "FCM 토큰 네이티브 등록 완료, 코드: ${conn.responseCode}")
                conn.disconnect()
            } catch (e: Exception) {
                Log.e(TAG, "FCM 토큰 네이티브 등록 실패: ${e.message}")
            }
        }.start()
    }

    /**
     * 새 토큰이 생성될 때 호출됨 (최초 설치 또는 갱신 시)
     */
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d(TAG, "새 FCM 토큰 생성됨: $token")
        registerToken(token)
    }
}
