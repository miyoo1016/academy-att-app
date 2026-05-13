package com.mirae.academyatt

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.util.Log
import java.time.Instant
import java.util.Calendar
import org.json.JSONObject

/**
 * 하루 2회 고정 Rescue 알람.
 *
 * 이 Receiver는 Activity를 띄우지 않고 SmsWatchdogService만 깨워서
 * 최근 3일 processed:false 큐를 재처리한다.
 */
class DailyRescueAlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_DAILY_RESCUE) return
        triggerNow(context, "daily_rescue_alarm")
    }

    companion object {
        private const val TAG = "DailyRescue"
        const val ACTION_DAILY_RESCUE = "com.mirae.academyatt.DAILY_RESCUE"
        private const val PREFS_NAME = "academyatt_daily_rescue"
        private const val KEY_ENABLED = "enabled"
        private const val KEY_NEXT_AT = "next_at"
        private const val KEY_LAST_FIRED_AT = "last_fired_at"
        private const val KEY_LAST_RESULT = "last_result"
        private const val REQUEST_CODE = 1216

        fun isEnabled(context: Context): Boolean {
            return prefs(context).getBoolean(KEY_ENABLED, true)
        }

        fun setEnabled(context: Context, enabled: Boolean) {
            prefs(context).edit().putBoolean(KEY_ENABLED, enabled).apply()
            if (enabled) {
                scheduleNext(context, "enabled")
            } else {
                cancel(context)
                writeStatus(context, result = "disabled", enabledOverride = false, nextAtMs = 0L)
            }
        }

        fun scheduleNext(context: Context, reason: String = "schedule") {
            if (!isEnabled(context)) {
                writeStatus(context, result = "disabled:$reason", enabledOverride = false, nextAtMs = 0L)
                return
            }

            val nextAt = nextRescueAtMillis()
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val pi = pendingIntent(context)
            val exactAllowed = canScheduleExactAlarm(context)

            try {
                am.cancel(pi)
                if (exactAllowed) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, nextAt, pi)
                    } else {
                        am.setExact(AlarmManager.RTC_WAKEUP, nextAt, pi)
                    }
                } else {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, nextAt, pi)
                    } else {
                        am.set(AlarmManager.RTC_WAKEUP, nextAt, pi)
                    }
                }

                prefs(context).edit()
                    .putLong(KEY_NEXT_AT, nextAt)
                    .putBoolean(KEY_ENABLED, true)
                    .apply()

                val result = if (exactAllowed) "scheduled:$reason" else "scheduled_inexact_no_exact_permission:$reason"
                val error = if (exactAllowed) null else "정확한 알람 권한 없음: 설정 필요"
                writeStatus(context, result = result, nextAtMs = nextAt, exactAllowed = exactAllowed, lastError = error)
                Log.i(TAG, "Daily Rescue scheduled: ${Instant.ofEpochMilli(nextAt)} exact=$exactAllowed reason=$reason")
            } catch (e: SecurityException) {
                writeStatus(
                    context,
                    result = "schedule_failed:$reason",
                    nextAtMs = nextAt,
                    exactAllowed = exactAllowed,
                    lastError = "SecurityException: ${e.message}"
                )
                Log.e(TAG, "Daily Rescue schedule failed", e)
            } catch (e: Exception) {
                writeStatus(
                    context,
                    result = "schedule_failed:$reason",
                    nextAtMs = nextAt,
                    exactAllowed = exactAllowed,
                    lastError = "${e.javaClass.simpleName}: ${e.message}"
                )
                Log.e(TAG, "Daily Rescue schedule failed", e)
            }
        }

        fun cancel(context: Context) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            am.cancel(pendingIntent(context))
            prefs(context).edit().putLong(KEY_NEXT_AT, 0L).apply()
        }

        fun triggerNow(context: Context, source: String = "daily_rescue_manual") {
            val firedAt = Instant.now().toString()
            prefs(context).edit()
                .putLong(KEY_LAST_FIRED_AT, System.currentTimeMillis())
                .putString(KEY_LAST_RESULT, "fired:$source")
                .apply()

            writeStatus(context, result = "fired:$source", firedAt = firedAt)

            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            val wakeLock = pm.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "AcademyDailyRescue::WakeLock"
            ).apply {
                setReferenceCounted(false)
                acquire(10 * 60 * 1000L)
            }

            try {
                SmsWatchdogService.start(context, source)
                SmsWatchdogService.processPendingNow(context, source)
                writeStatus(context, result = "watchdog_started:$source", firedAt = firedAt)
            } catch (e: Exception) {
                writeStatus(
                    context,
                    result = "failed:$source",
                    firedAt = firedAt,
                    lastError = "${e.javaClass.simpleName}: ${e.message}"
                )
                SmsWatchdogService.writeWatchdogStatus(
                    context,
                    "daily_rescue_failed:$source",
                    lastError = "${e.javaClass.simpleName}: ${e.message}"
                )
            } finally {
                if (wakeLock.isHeld) wakeLock.release()
                scheduleNext(context, "after_fire")
            }
        }

        fun statusMap(context: Context): JSONObject {
            val p = prefs(context)
            return JSONObject()
                .put("enabled", isEnabled(context))
                .put("nextAt", p.getLong(KEY_NEXT_AT, 0L))
                .put("lastFiredAt", p.getLong(KEY_LAST_FIRED_AT, 0L))
                .put("lastResult", p.getString(KEY_LAST_RESULT, "") ?: "")
                .put("exactAlarmPermission", canScheduleExactAlarm(context))
        }

        fun canScheduleExactAlarm(context: Context): Boolean {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            return am.canScheduleExactAlarms()
        }

        private fun pendingIntent(context: Context): PendingIntent {
            val intent = Intent(context, DailyRescueAlarmReceiver::class.java).apply {
                action = ACTION_DAILY_RESCUE
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            return PendingIntent.getBroadcast(context, REQUEST_CODE, intent, flags)
        }

        private fun nextRescueAtMillis(nowMs: Long = System.currentTimeMillis()): Long {
            val now = Calendar.getInstance().apply { timeInMillis = nowMs }
            val nextNoon = candidate(now, 12)
            if (nextNoon.timeInMillis > nowMs) return nextNoon.timeInMillis
            val nextFour = candidate(now, 16)
            if (nextFour.timeInMillis > nowMs) return nextFour.timeInMillis
            return candidate(now, 12).apply { add(Calendar.DAY_OF_YEAR, 1) }.timeInMillis
        }

        private fun candidate(now: Calendar, hour: Int): Calendar {
            return (now.clone() as Calendar).apply {
                set(Calendar.HOUR_OF_DAY, hour)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }
        }

        private fun prefs(context: Context) =
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        private fun writeStatus(
            context: Context,
            result: String,
            enabledOverride: Boolean? = null,
            nextAtMs: Long? = null,
            firedAt: String? = null,
            exactAllowed: Boolean? = null,
            lastError: String? = null
        ) {
            Thread {
                try {
                    val fields = JSONObject()
                    fields.put("updatedAt", JSONObject().put("timestampValue", Instant.now().toString()))
                    fields.put("dailyRescueEnabled", JSONObject().put("booleanValue", enabledOverride ?: isEnabled(context)))
                    fields.put("dailyRescueScheduleResult", JSONObject().put("stringValue", result))
                    if (!result.startsWith("scheduled")) {
                        fields.put("lastDailyRescueResult", JSONObject().put("stringValue", result))
                    }
                    fields.put("dailyRescueExactAlarmAllowed", JSONObject().put("booleanValue", exactAllowed ?: canScheduleExactAlarm(context)))
                    nextAtMs?.let {
                        if (it > 0L) {
                            fields.put("dailyRescueNextAt", JSONObject().put("timestampValue", Instant.ofEpochMilli(it).toString()))
                        }
                    }
                    firedAt?.let {
                        fields.put("dailyRescueFiredAt", JSONObject().put("timestampValue", it))
                    }
                    lastError?.let {
                        fields.put("dailyRescueLastError", JSONObject().put("stringValue", it.take(500)))
                        fields.put("lastError", JSONObject().put("stringValue", it.take(500)))
                    }

                    val masks = fields.keys().asSequence().joinToString("") { "&updateMask.fieldPaths=$it" }
                    val body = JSONObject().put("fields", fields).toString()
                    SmsWatchdogService.patchJson(
                        "https://firestore.googleapis.com/v1/projects/${SmsWatchdogService.FIREBASE_PROJECT_ID}/databases/(default)/documents/watchdogStatus/main_terminal?$masks&key=${SmsWatchdogService.API_KEY}",
                        body
                    )
                } catch (e: Exception) {
                    Log.e(TAG, "Daily Rescue status write failed: ${e.message}")
                }
            }.start()
        }
    }
}
