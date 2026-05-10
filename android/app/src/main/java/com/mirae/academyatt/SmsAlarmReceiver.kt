package com.mirae.academyatt

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.util.Log

/**
 * SmsAlarmReceiver
 *
 * ─── 왜 이게 필요한가? ────────────────────────────────────────────────────────
 *
     * 기존 구조의 치명적 결함:
     *   1. react-native-background-actions는 JS Thread 위에서 동작
     *   2. Android가 메모리/배터리 압박 시 JS Thread를 suspend(일시정지)
     *   3. JS Thread를 깨우려는 복구 과정에서 MainActivity가 노출될 수 있음
     *
     * 해결 방법:
     *   AlarmManager로 이 BroadcastReceiver를 주기적(10분)으로 깨움.
     *   BroadcastReceiver는 Android 10+에서도 백그라운드에서 실행 가능.
     *   onReceive()에서:
     *     1. WakeLock 획득 (CPU 슬립 방지)
     *     2. 네이티브 서비스 생존 여부 + 하트비트 staleness 확인
     *     3. 이상 상태면 → SmsWatchdogService만 재시작
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */
class SmsAlarmReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "SmsAlarmReceiver"
        const val ACTION_WATCHDOG_ALARM = "com.mirae.academyatt.WATCHDOG_ALARM"
        private const val ALARM_INTERVAL_MS = 10 * 60 * 1000L  // 10분마다 감시 (자극 최소화)
        private const val HEARTBEAT_STALE_MS = 10 * 60 * 1000L // 10분 이상 ping 없으면 상태 이상
        private const val KICK_INTERVAL_MS = 3 * 60 * 60 * 1000L // 3시간마다 정기 점검
        /**
         * AlarmManager에 반복 알람 등록
         * 앱 시작, 부팅 완료 시 호출
         */
        fun scheduleRepeatingAlarm(context: Context) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val pi = buildPendingIntent(context)

            // 기존 알람 취소 후 재등록 (중복 방지)
            am.cancel(pi)

            val triggerAt = System.currentTimeMillis() + ALARM_INTERVAL_MS

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    // RTC_WAKEUP: CPU를 수면 상태에서 깨움 (백그라운드 생존 핵심)
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
                } else {
                    am.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pi)
                }
                Log.d(TAG, "알람 등록 완료 (10분 후 실행)")
            } catch (e: Exception) {
                Log.e(TAG, "알람 등록 실패: ${e.message}")
                // 정확한 알람 등록 실패 시 부정확한 방식으로 폴백
                am.setInexactRepeating(
                    AlarmManager.RTC_WAKEUP,
                    triggerAt,
                    ALARM_INTERVAL_MS,
                    pi
                )
            }
        }

        /**
         * 알람 취소 (앱이 명시적으로 중지될 때)
         */
        fun cancelAlarm(context: Context) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            am.cancel(buildPendingIntent(context))
            Log.d(TAG, "알람 취소됨")
        }

        private fun buildPendingIntent(context: Context): PendingIntent {
            val intent = Intent(context, SmsAlarmReceiver::class.java).apply {
                action = ACTION_WATCHDOG_ALARM
                putExtra("is_background_launch", true)
            }
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }
            return PendingIntent.getBroadcast(context, 0, intent, flags)
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        Log.d(TAG, "알람 수신: ${intent.action}")

        // === WakeLock 획득 (CPU 슬립 방지, 10분 타임아웃) ===
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val wakeLock = pm.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "AcademyAlarm::WakeLock"
        ).apply { acquire(10 * 60 * 1000L) }

        try {
            when (intent.action) {
                ACTION_WATCHDOG_ALARM -> {
                    // 시스템에 의한 자동 실행임을 표시하는 플래그 (MainActivity에서 사용)
                    intent.putExtra("is_background_launch", true)
                    handleWatchdogAlarm(context)
                }
            }
        } finally {
            // 처리 완료 후 WakeLock 해제
            if (wakeLock.isHeld) wakeLock.release()
            // === 다음 알람 재등록 (고정 반복 대신 다음 알람 재등록: Doze 호환) ===
            scheduleRepeatingAlarm(context)
        }
    }

    /**
     * 핵심 로직: 네이티브 서비스 상태 확인 및 강제 재시작
     */
    private fun handleWatchdogAlarm(context: Context) {
        Log.d(TAG, "=== Watchdog 알람 실행 ===")

        val lastPing = HeartbeatModule.getLastPing(context)
        val ageMs = System.currentTimeMillis() - lastPing
        val ageMin = ageMs / 60_000L

        Log.d(TAG, "마지막 네이티브 하트비트: ${ageMin}분 전")

        val isZombie = lastPing > 0L && ageMs > HEARTBEAT_STALE_MS
        val isNeverStarted = lastPing == 0L

        // ── 사용자 요청: 2~3시간마다 강제 깨우기 로직 추가 ──
        val lastKick = HeartbeatModule.getLastKick(context)
        val sinceLastKickMs = System.currentTimeMillis() - lastKick
        val isPeriodicKickTime = sinceLastKickMs > KICK_INTERVAL_MS

        if (isNeverStarted || isZombie || isPeriodicKickTime) {
            if (isPeriodicKickTime) {
                Log.i(TAG, "⏰ 정기 점검 실행 (무인)")
            } else if (isZombie) {
                Log.w(TAG, "⚠️ 좀비 상태 감지 (${ageMin}분 전) → 무인 복구 시도")
            } else {
                Log.w(TAG, "⚠️ 미시작 감지 → 무인 시작")
            }
            HeartbeatModule.updateLastKick(context)
            triggerSilentRecovery(context)
        } else {
            Log.d(TAG, "✅ 정상 작동 중 (마지막 핑: ${ageMin}분 전) → 추가 조치 없음")
            SmsWatchdogService.start(context, "alarm")
            SmsWatchdogService.processPendingNow(context, "alarm")
        }
    }

    /**
     * 화면을 열지 않고 네이티브 감시 서비스만 복구/시작함
     */
    private fun triggerSilentRecovery(context: Context) {
        try {
            // [근본적 해결] 엔진(JS)을 깨우지 않고 네이티브 서비스만 실행
            // 이제 리액트 네이티브 엔진은 사용자가 앱을 직접 켰을 때만 돌아갑니다.
            // 백그라운드 문자 발송은 SmsWatchdogService(네이티브)가 전담합니다.
            SmsWatchdogService.start(context, "alarm_recovery")
            SmsWatchdogService.processPendingNow(context, "alarm_recovery")
            
            Log.i(TAG, "✅ [완전 무음 모드] 네이티브 감시 서비스 가동")
        } catch (e: Exception) {
            Log.e(TAG, "❌ 복구 실패: ${e.message}")
        }
    }


    /**
     * 시스템 리프레시 알림 표시 (시스템이 앱을 살아있는 것으로 간주하도록 유도)
     */
    private fun showRefreshNotification(context: Context, title: String, message: String) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = android.app.NotificationChannel(
                "system_refresh", "시스템 상태 유지",
                android.app.NotificationManager.IMPORTANCE_LOW
            )
            nm.createNotificationChannel(channel)
        }

        // 클릭해도 아무 일도 일어나지 않도록 빈 인텐트 설정
        val pi = PendingIntent.getBroadcast(
            context, 1, Intent(),
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        )

        val notification = androidx.core.app.NotificationCompat.Builder(context, "system_refresh")
            .setContentTitle(title)
            .setContentText(message)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build()

        nm.notify(1001, notification)
    }
}
