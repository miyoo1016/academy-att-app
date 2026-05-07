package com.mirae.academyatt

import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

/**
 * HeartbeatModule
 *
 * JS 백그라운드 서비스(SmsBackgroundService.js)에서 3초마다 ping()을 호출.
 * SharedPreferences에 현재 타임스탬프를 기록.
 * SmsWatchdogService(Kotlin)와 SmsAlarmReceiver(Kotlin)가 이 값을 읽어서
 * JS 서비스가 진짜로 동작 중인지 판단한다.
 *
 * 해결하는 문제:
 * RNBackgroundActionsTask 프로세스는 살아있지만
 * 내부 Firebase 리스너가 죽은 "좀비 상태"를 Watchdog이 감지하게 해준다.
 */
class HeartbeatModule(reactContext: ReactApplicationContext)
    : ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "HeartbeatModule"

    /** JS 서비스 루프에서 매 3초 호출 — ping 시각 갱신 */
    @ReactMethod
    fun ping() {
        val prefs = reactApplicationContext
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putLong(KEY_PING, System.currentTimeMillis()).apply()
    }

    /** 배터리 최적화 제외 여부 확인 */
    @ReactMethod
    fun isIgnoringBatteryOptimizations(promise: Promise) {
        val pm = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
        val packageName = reactApplicationContext.packageName
        promise.resolve(pm.isIgnoringBatteryOptimizations(packageName))
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
        }
    }

    companion object {
        const val PREFS_NAME = "academyatt_heartbeat"
        const val KEY_PING   = "last_ping"

        /** SmsWatchdogService / SmsAlarmReceiver에서 호출 */
        fun getLastPing(context: Context): Long {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            return prefs.getLong(KEY_PING, 0L)
        }

        /**
         * ping 값을 0으로 초기화하여 다음 Watchdog 사이클에서
         * lastPing == 0L → "아직 시작 안 됨" 으로 인식되게 함.
         * SmsAlarmReceiver가 강제 재시작 후 호출하여 JS가 다시 ping하도록 유도.
         */
        fun resetPing(context: Context) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putLong(KEY_PING, 0L).apply()
        }
    }
}
