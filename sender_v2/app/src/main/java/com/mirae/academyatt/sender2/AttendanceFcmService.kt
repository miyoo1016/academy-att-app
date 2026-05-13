package com.mirae.academyatt.sender2

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Receives the FCM data payload emitted by Cloud Functions
 * (`sendAttendanceFcm` / `retryPendingAttendanceFcm`) and forwards it to
 * [AttendanceDispatcher] which owns the dedup + SMS logic.
 */
class AttendanceFcmService : FirebaseMessagingService() {

    companion object {
        private const val TAG = "AttendanceFcmService"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)
        val data = remoteMessage.data
        Log.d(TAG, "FCM received: keys=${data.keys}")
        if (data.isEmpty()) return

        if (data["type"] != "ATTENDANCE_SMS") {
            Log.d(TAG, "Ignored payload type=${data["type"]}")
            return
        }

        val fields = AttendanceDispatcher.parseFromFcm(data)
        if (fields == null) {
            Log.w(TAG, "Malformed payload — missing id/studentName")
            return
        }

        scope.launch {
            try {
                AttendanceDispatcher.dispatch(applicationContext, fields)
            } catch (e: Exception) {
                Log.e(TAG, "dispatch failed: ${e.message}", e)
                StatusStore.recordSmsFailure(
                    applicationContext,
                    fields.studentName,
                    e.message ?: "dispatch_exception"
                )
            }
        }
    }

    /**
     * When the SDK generates a new token (first install, app data clear,
     * reinstall) we re-register so the Cloud Function picks up the fresh
     * registration immediately.
     */
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.i(TAG, "onNewToken — re-registering main_phone_v2")
        scope.launch {
            TokenRegistrar.register(applicationContext, token)
        }
    }
}
