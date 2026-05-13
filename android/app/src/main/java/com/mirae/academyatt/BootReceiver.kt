package com.mirae.academyatt

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * BootReceiver
 * 기기 재부팅 또는 앱 업데이트 후:
 *   1. SmsWatchdogService 시작
 *   2. SmsAlarmReceiver AlarmManager 알람 재등록
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        Log.d("BootReceiver", "수신: $action")

        if (action == Intent.ACTION_BOOT_COMPLETED ||
            action == Intent.ACTION_MY_PACKAGE_REPLACED) {

            Log.i("BootReceiver", "부팅/업데이트 → Watchdog + AlarmManager + Daily Rescue 시작")
            SmsWatchdogService.start(context)
            SmsAlarmReceiver.scheduleRepeatingAlarm(context)
            DailyRescueAlarmReceiver.scheduleNext(context, "boot")
        }
    }
}
