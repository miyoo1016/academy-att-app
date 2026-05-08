package com.mirae.academyatt

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class SilentRecoveryService : HeadlessJsTaskService() {
    override fun onCreate() {
        super.onCreate()
        // startForegroundService()로 시작된 경우, 5초 이내에 startForeground()를 호출하지 않으면 앱이 종료됨.
        // 이를 방지하기 위해 최소한의 상단바 알림 표시
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channelId = "silent_recovery_channel"
            val channelName = "시스템 무음 복구"
            val channel = android.app.NotificationChannel(channelId, channelName, android.app.NotificationManager.IMPORTANCE_MIN)
            val manager = getSystemService(android.app.NotificationManager::class.java)
            manager.createNotificationChannel(channel)
            
            val notification = androidx.core.app.NotificationCompat.Builder(this, channelId)
                .setContentTitle("시스템 최적화 중")
                .setContentText("백그라운드 성능을 유지하고 있습니다")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setPriority(androidx.core.app.NotificationCompat.PRIORITY_MIN)
                .build()
            
            startForeground(8888, notification)
        }
    }

    override fun getTaskConfig(intent: Intent): HeadlessJsTaskConfig? {
        return intent.extras?.let {
            HeadlessJsTaskConfig(
                "SilentRecoveryTask",
                Arguments.fromBundle(it),
                5000, // timeout for the task
                true  // allowed in foreground
            )
        } ?: HeadlessJsTaskConfig(
            "SilentRecoveryTask",
            Arguments.createMap(),
            5000,
            true
        )
    }
}
