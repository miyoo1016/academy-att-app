package com.mirae.academyatt

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * SmsWatchdogService - 경량화된 포그라운드 서비스
 * 
 * 이제 실시간 감시는 FCM(구글 제공)이 전담하므로,
 * 이 서비스는 프로세스가 시스템에 의해 우선순위에서 밀려 종료되는 것을 방지하는
 * 최소한의 Foreground Service 역할만 수행합니다.
 */
class SmsWatchdogService : Service() {

    companion object {
        private const val TAG = "SmsWatchdog"
        private const val CHANNEL_ID = "academy_watchdog_channel"
        private const val NOTIFICATION_ID = 9999

        fun start(context: Context) {
            val intent = Intent(context, SmsWatchdogService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
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
        return START_STICKY
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
            .setContentTitle("미래학원 출결 신호 대기 중")
            .setContentText("메시지 자동 발송 시스템 가동 중")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setPriority(NotificationCompat.PRIORITY_MIN)
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
