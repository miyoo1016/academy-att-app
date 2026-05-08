package com.mirae.academyatt

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.util.Log
import android.telephony.SmsManager

/**
 * SmsAlarmReceiver
 *
 * ─── 왜 이게 필요한가? ────────────────────────────────────────────────────────
 *
 * 기존 구조의 치명적 결함:
 *   1. react-native-background-actions는 JS Thread 위에서 동작
 *   2. Android가 메모리/배터리 압박 시 JS Thread를 suspend(일시정지)
 *   3. JS Thread가 멈추면 Firestore onSnapshot, pingHeartbeat 모두 멈춤
 *   4. Watchdog이 "좀비 감지" 후 startActivity()로 앱 포그라운드 복귀 시도
 *   5. BUT: Android 10+에서 백그라운드 앱의 startActivity()는 OS가 차단함
 *      → 화면이 꺼진 상태에서 실제로 앱이 올라오지 않음 → 문자 계속 미발송
 *
 * 해결 방법:
 *   AlarmManager로 이 BroadcastReceiver를 주기적(5분)으로 깨움.
 *   BroadcastReceiver는 Android 10+에서도 백그라운드에서 실행 가능.
 *   onReceive()에서:
 *     1. WakeLock 획득 (CPU 슬립 방지)
 *     2. JS 서비스 생존 여부 + 하트비트 staleness 확인
 *     3. 좀비 상태면 → RNBackgroundActionsTask 서비스를 직접 재시작
 *     4. 미처리된 SMS가 있는지 SharedPreferences에서 확인하여 발송
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */
class SmsAlarmReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "SmsAlarmReceiver"
        const val ACTION_WATCHDOG_ALARM = "com.mirae.academyatt.WATCHDOG_ALARM"
        private const val ALARM_INTERVAL_MS = 5 * 60 * 1000L  // 5분마다 감시 (과거 성공했던 주기)
        private const val HEARTBEAT_STALE_MS = 5 * 60 * 1000L // 5분 이상 ping 없으면 상태 이상으로 간주
        private const val KICK_INTERVAL_MS = 2 * 60 * 60 * 1000L // 2시간마다 정기 점검
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
                Log.d(TAG, "알람 등록 완료 (5분 후 실행)")
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
                Intent.ACTION_BOOT_COMPLETED,
                Intent.ACTION_MY_PACKAGE_REPLACED -> {
                    Log.i(TAG, "부팅/업데이트 → 알람 재등록 + 서비스 시작")
                    SmsWatchdogService.start(context)
                    scheduleRepeatingAlarm(context)
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
     * 핵심 로직: JS 서비스 좀비 상태 확인 및 강제 재시작
     */
    private fun handleWatchdogAlarm(context: Context) {
        Log.d(TAG, "=== Watchdog 알람 실행 ===")

        val lastPing = HeartbeatModule.getLastPing(context)
        val ageMs = System.currentTimeMillis() - lastPing
        val ageMin = ageMs / 60_000L

        Log.d(TAG, "마지막 JS 하트비트: ${ageMin}분 전")

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
            // 네이티브 서비스 생존만 확인 (화면 켬 방지)
            SmsWatchdogService.start(context)
        }
    }

    /**
     * JS 백그라운드 서비스를 네이티브에서 직접 재시작
     *
     * RNBackgroundActionsTask는 앱의 MainActivity가 실행되어야 JS가 초기화됨.
     * 따라서 MainActivity에 특별한 Intent를 보내서 JS 서비스를 재시작시킴.
     *
     * Android 10+에서도 BroadcastReceiver → startForegroundService는 허용됨.
     * (startActivity와 달리 서비스 시작은 백그라운드에서도 가능)
     */
    /**
     * Headless JS를 통해 화면을 띄우지 않고 백그라운드 서비스를 복구/시작함
     */
    /**
     * Headless JS를 통해 화면을 띄우지 않고 백그라운드 서비스를 복구/시작함
     */
    private fun triggerSilentRecovery(context: Context) {
        try {
            // [근본적 해결] 엔진(JS)을 깨우지 않고 네이티브 서비스만 실행
            // 이제 리액트 네이티브 엔진은 사용자가 앱을 직접 켰을 때만 돌아갑니다.
            // 백그라운드 문자 발송은 SmsWatchdogService(네이티브)가 전담합니다.
            SmsWatchdogService.start(context)
            
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
