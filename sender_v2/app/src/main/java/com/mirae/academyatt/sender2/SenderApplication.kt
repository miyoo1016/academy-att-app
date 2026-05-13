package com.mirae.academyatt.sender2

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build

/**
 * Application entry point for the V2 SMS sender.
 *
 * Creates the (silent) notification channel that FCM will use for any
 * fallback notification path. The bulk of the work happens in
 * [AttendanceFcmService] and [MainActivity].
 */
class SenderApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                "academy_sender_v2_channel",
                "출결 SMS 발송",
                NotificationManager.IMPORTANCE_MIN
            ).apply {
                description = "FCM 출결 푸시 수신용"
                setShowBadge(false)
                setSound(null, null)
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm?.createNotificationChannel(channel)
        }
    }
}
