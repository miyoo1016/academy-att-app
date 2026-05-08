package com.mirae.academyatt

import android.telephony.SmsManager
import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONArray
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
        SmsWatchdogService.start(applicationContext)

        // 1. Data 페이로드 확인
        if (remoteMessage.data.isNotEmpty()) {
            val type = remoteMessage.data["type"]
            Log.d(TAG, "메시지 데이터 수신: type=$type")

            if (type == "ATTENDANCE_SMS") {
                handleAttendanceSms(remoteMessage.data)
            }
        }
    }

    /**
     * 출석 SMS 발송 처리
     */
    private fun handleAttendanceSms(data: Map<String, String>) {
        val studentName = data["studentName"] ?: "학생"
        val attendanceType = data["attendanceType"] ?: "checkin"
        val time = data["time"] ?: ""
        val phonesJson = data["parentPhones"] ?: "[]"

        Log.i(TAG, "SMS 발송 시도: $studentName (${if(attendanceType=="checkin") "등원" else "하원"})")

        try {
            val phonesArray = JSONArray(phonesJson)
            val message = if (attendanceType == "checkin") {
                "[미래학원] $time $studentName 원생이 등원하였습니다. 최선을 다해 지도하겠습니다."
            } else {
                "[미래학원] $time $studentName 원생이 공부를 마치고 귀가할 예정입니다."
            }

            if (phonesArray.length() == 0) {
                Log.w(TAG, "수신 가능한 전화번호가 없습니다.")
                return
            }

            // 최신 안드로이드(API 31+) 대응 SmsManager 취득
            val smsManager: SmsManager? = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                applicationContext.getSystemService(SmsManager::class.java)
            } else {
                @Suppress("DEPRECATION")
                SmsManager.getDefault()
            }

            if (smsManager == null) {
                Log.e(TAG, "❌ SmsManager를 가져올 수 없습니다.")
                return
            }

            var sentSuccessfully = false
            for (i in 0 until phonesArray.length()) {
                val phone = phonesArray.getString(i)
                if (phone.isNotBlank()) {
                    smsManager.sendTextMessage(phone, null, message, null, null)
                    Log.i(TAG, "✅ SMS 발송 완료: $phone")
                    sentSuccessfully = true
                }
            }

            // 발송 성공 시 Firestore 업데이트 (중복 방지 핵심)
            if (sentSuccessfully) {
                val docId = data["id"]
                if (docId != null) {
                    markAsProcessed(docId)
                }
            }

        } catch (e: Exception) {
            Log.e(TAG, "❌ SMS 발송 중 오류 발생: ${e.message}")
        }
    }

    /**
     * Firestore REST API를 사용하여 문서를 처리 완료로 마킹
     */
    private fun markAsProcessed(docId: String) {
        Thread {
            try {
                // Correct API Key from google-services.json
                val urlString = "https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents/attendance/$docId?updateMask.fieldPaths=processed&key=$API_KEY"
                val url = URL(urlString)
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "PATCH"
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")

                val body = "{\"fields\":{\"processed\":{\"booleanValue\":true}}}"
                conn.outputStream.use { os ->
                    os.write(body.toByteArray())
                }

                val responseCode = conn.responseCode
                Log.i(TAG, "Firestore 업데이트 완료 (ID: $docId), 코드: $responseCode")
                conn.disconnect()
            } catch (e: Exception) {
                Log.e(TAG, "Firestore 업데이트 실패: ${e.message}")
            }
        }.start()
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
