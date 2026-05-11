package com.mirae.academyatt

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableNativeMap

/**
 * HeartbeatModule
 *
 * 네이티브 Watchdog이 생존 신호를 기록한다.
 * SharedPreferences에 현재 타임스탬프를 기록.
 * SmsWatchdogService(Kotlin)와 SmsAlarmReceiver(Kotlin)가 이 값을 읽어서
 * 네이티브 감시 서비스가 진짜로 동작 중인지 판단한다.
 *
 * 해결하는 문제:
 * 포그라운드 서비스 프로세스는 살아있지만
 * 내부 폴링 루프가 죽은 "좀비 상태"를 Watchdog이 감지하게 해준다.
 */
class HeartbeatModule(reactContext: ReactApplicationContext)
    : ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "HeartbeatModule"

    /** JS에서 상태 확인용으로 호출할 수 있는 ping 시각 갱신 */
    @ReactMethod
    fun ping() {
        val prefs = reactApplicationContext
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putLong(KEY_PING, System.currentTimeMillis()).apply()
    }

    /** 마지막 하트비트 시각 조회 (JS에서 상태 체크용) */
    @ReactMethod
    fun getLastPing(promise: Promise) {
        val prefs = reactApplicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        promise.resolve(prefs.getLong(KEY_PING, 0L).toDouble())
    }

    /** JS 앱 실행/복귀 시 네이티브 Watchdog을 다시 시작하고 미발송분 처리를 트리거 */
    @ReactMethod
    fun startWatchdog() {
        SmsWatchdogService.start(reactApplicationContext, "app")
        SmsWatchdogService.processPendingNow(reactApplicationContext, "app")
    }

    /** Dashboard 진단 버튼: Foreground Service 재시작 */
    @ReactMethod
    fun restartWatchdog(promise: Promise) {
        try {
            SmsWatchdogService.start(reactApplicationContext, "manual_restart")
            promise.resolve(true)
        } catch (e: Exception) {
            SmsWatchdogService.writeWatchdogStatus(
                reactApplicationContext,
                "manual_restart_failed",
                lastError = "${e.javaClass.simpleName}: ${e.message}"
            )
            promise.reject("WATCHDOG_RESTART_FAILED", e.message, e)
        }
    }

    /** Dashboard 진단 버튼: 최근 3일 미발송 큐 즉시 drain */
    @ReactMethod
    fun drainPendingSmsQueue(promise: Promise) {
        try {
            SmsWatchdogService.processPendingNow(reactApplicationContext, "manual_drain")
            promise.resolve(true)
        } catch (e: Exception) {
            SmsWatchdogService.writeWatchdogStatus(
                reactApplicationContext,
                "manual_drain_failed",
                lastError = "${e.javaClass.simpleName}: ${e.message}"
            )
            promise.reject("WATCHDOG_DRAIN_FAILED", e.message, e)
        }
    }

    /** Dashboard 표시용 로컬 권한/절전 상태 */
    @ReactMethod
    fun getDiagnosticStatus(promise: Promise) {
        try {
            val pm = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
            val packageName = reactApplicationContext.packageName
            val map = WritableNativeMap()
            map.putBoolean("batteryOptimizationsIgnored", pm.isIgnoringBatteryOptimizations(packageName))
            map.putBoolean(
                "smsPermission",
                ContextCompat.checkSelfPermission(
                    reactApplicationContext,
                    android.Manifest.permission.SEND_SMS
                ) == PackageManager.PERMISSION_GRANTED
            )
            map.putBoolean(
                "notificationPermission",
                if (Build.VERSION.SDK_INT >= 33) {
                    ContextCompat.checkSelfPermission(
                        reactApplicationContext,
                        android.Manifest.permission.POST_NOTIFICATIONS
                    ) == PackageManager.PERMISSION_GRANTED
                } else {
                    NotificationManagerCompat.from(reactApplicationContext).areNotificationsEnabled()
                }
            )
            map.putDouble("lastNativePing", getLastPing(reactApplicationContext).toDouble())
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("DIAGNOSTIC_STATUS_FAILED", e.message, e)
        }
    }

    /** 배터리 최적화 제외 여부 확인 */
    @ReactMethod
    fun isIgnoringBatteryOptimizations(promise: Promise) {
        val pm = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
        val packageName = reactApplicationContext.packageName
        promise.resolve(pm.isIgnoringBatteryOptimizations(packageName))
    }

    /** SMS 발송 권한 여부 */
    @ReactMethod
    fun hasSmsPermission(promise: Promise) {
        promise.resolve(
            ContextCompat.checkSelfPermission(
                reactApplicationContext,
                android.Manifest.permission.SEND_SMS
            ) == PackageManager.PERMISSION_GRANTED
        )
    }

    /** 알림 권한 여부. Android 13 미만은 앱 알림 차단 여부를 확인한다. */
    @ReactMethod
    fun hasNotificationPermission(promise: Promise) {
        val enabled = if (Build.VERSION.SDK_INT >= 33) {
            ContextCompat.checkSelfPermission(
                reactApplicationContext,
                android.Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            NotificationManagerCompat.from(reactApplicationContext).areNotificationsEnabled()
        }
        promise.resolve(enabled)
    }

    /** 배터리 최적화 제외 요청 창 띄우기 */
    @ReactMethod
    fun requestIgnoreBatteryOptimizations() {
        val pm = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
        val packageName = reactApplicationContext.packageName
        if (!pm.isIgnoringBatteryOptimizations(packageName)) {
            val intent = Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:$packageName")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactApplicationContext.startActivity(intent)
        } else {
            val intent = Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.parse("package:$packageName")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactApplicationContext.startActivity(intent)
        }
    }

    /** 더 명확한 JS 메서드명 별칭 */
    @ReactMethod
    fun openBatteryOptimizationSettings() {
        requestIgnoreBatteryOptimizations()
    }
    /** 다른 앱 위에 그리기(오버레이) 권한 여부 확인 */
    @ReactMethod
    fun canDrawOverlays(promise: Promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            promise.resolve(android.provider.Settings.canDrawOverlays(reactApplicationContext))
        } else {
            promise.resolve(true)
        }
    }

    /** 다른 앱 위에 그리기 권한 설정 창 띄우기 */
    @ReactMethod
    fun requestOverlayPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val packageName = reactApplicationContext.packageName
            val intent = Intent(
                android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName")
            ).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactApplicationContext.startActivity(intent)
        }
    }

    companion object {
        const val PREFS_NAME = "academyatt_heartbeat"
        const val KEY_PING   = "last_ping"
        const val KEY_LAST_KICK = "last_kick_time"

        /** 서비스 생존 확인 시각 갱신 (SmsAlarmReceiver에서 호출 가능하도록) */
        fun updateLastKick(context: Context) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putLong(KEY_LAST_KICK, System.currentTimeMillis()).apply()
        }

        /** 마지막 강제 깨우기 시각 조회 */
        fun getLastKick(context: Context): Long {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            return prefs.getLong(KEY_LAST_KICK, 0L)
        }

        /** SmsWatchdogService / SmsAlarmReceiver에서 호출 */
        fun getLastPing(context: Context): Long {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            return prefs.getLong(KEY_PING, 0L)
        }

        /** 순수 네이티브 Watchdog 생존 확인 시각 갱신 */
        fun pingHeartbeat(context: Context) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putLong(KEY_PING, System.currentTimeMillis()).apply()
        }

        /**
         * ping 값을 0으로 초기화하여 다음 Watchdog 사이클에서
         * lastPing == 0L → "아직 시작 안 됨" 으로 인식되게 함.
         */
        fun resetPing(context: Context) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putLong(KEY_PING, 0L).apply()
        }
    }
}
