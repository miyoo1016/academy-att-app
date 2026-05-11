package com.mirae.academyatt

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.SmsManager
import android.util.Log
import java.time.Instant

/**
 * SmsSentReceiver
 *
 * SmsManager 호출 성공이 아니라 Android sent 결과를 기준으로 attendance 상태를 확정합니다.
 * 모든 part/수신자 sent 결과가 RESULT_OK일 때만 processed:true가 됩니다.
 */
class SmsSentReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_SMS_SENT) return

        val docId = intent.getStringExtra(EXTRA_DOC_ID) ?: return
        val source = intent.getStringExtra(EXTRA_SOURCE) ?: "watchdog"
        val retryCount = intent.getIntExtra(EXTRA_RETRY_COUNT, 0)
        val expected = intent.getIntExtra(EXTRA_EXPECTED, 1).coerceAtLeast(1)
        val sentResultCode = resultCode
        val key = "sms_sent_$docId"

        synchronized(SmsSentReceiver::class.java) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            if (prefs.getBoolean("${key}_terminal", false)) return

            val done = prefs.getInt("${key}_done", 0) + 1
            val ok = prefs.getInt("${key}_ok", 0) + if (sentResultCode == Activity.RESULT_OK) 1 else 0
            val error = if (sentResultCode == Activity.RESULT_OK) {
                prefs.getString("${key}_error", "") ?: ""
            } else {
                smsResultText(sentResultCode)
            }

            prefs.edit()
                .putInt("${key}_done", done)
                .putInt("${key}_ok", ok)
                .putString("${key}_error", error)
                .apply()

            if (sentResultCode != Activity.RESULT_OK) {
                prefs.edit().putBoolean("${key}_terminal", true).apply()
                val msg = "SMS result failure: $error"
                Thread {
                    SmsWatchdogService.markFailure(docId, retryCount + 1, msg)
                    SmsWatchdogService.writeWatchdogStatus(
                        context,
                        "sms_failed:$source",
                        failureCount = 1,
                        lastError = msg
                    )
                }.start()
                Log.e(TAG, "$msg docId=$docId")
                return
            }

            if (done >= expected && ok >= expected) {
                prefs.edit().putBoolean("${key}_terminal", true).apply()
                val now = Instant.now().toString()
                Thread {
                    SmsWatchdogService.markSuccess(docId, source)
                    SmsWatchdogService.writeWatchdogStatus(
                        context,
                        "sms_sent_ok:$source",
                        successCount = 1,
                        lastSmsSuccessAt = now
                    )
                }.start()
                Log.i(TAG, "SMS RESULT_OK confirmed docId=$docId expected=$expected")
            }
        }
    }

    companion object {
        const val ACTION_SMS_SENT = "com.mirae.academyatt.SMS_SENT"
        private const val TAG = "SmsSentReceiver"
        private const val PREFS_NAME = "academyatt_sms_sent"
        private const val EXTRA_DOC_ID = "doc_id"
        private const val EXTRA_SOURCE = "source"
        private const val EXTRA_RETRY_COUNT = "retry_count"
        private const val EXTRA_EXPECTED = "expected"
        private const val EXTRA_INDEX = "index"

        fun prepare(context: Context, docId: String, source: String, retryCount: Int, expected: Int) {
            val key = "sms_sent_$docId"
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                .putString("${key}_source", source)
                .putInt("${key}_retry", retryCount)
                .putInt("${key}_expected", expected)
                .putInt("${key}_done", 0)
                .putInt("${key}_ok", 0)
                .putString("${key}_error", "")
                .putBoolean("${key}_terminal", false)
                .apply()
        }

        fun pendingIntent(
            context: Context,
            docId: String,
            source: String,
            retryCount: Int,
            expected: Int,
            index: Int
        ): PendingIntent {
            val intent = Intent(context, SmsSentReceiver::class.java).apply {
                action = ACTION_SMS_SENT
                putExtra(EXTRA_DOC_ID, docId)
                putExtra(EXTRA_SOURCE, source)
                putExtra(EXTRA_RETRY_COUNT, retryCount)
                putExtra(EXTRA_EXPECTED, expected)
                putExtra(EXTRA_INDEX, index)
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            return PendingIntent.getBroadcast(context, (docId + index).hashCode(), intent, flags)
        }

        private fun smsResultText(code: Int): String {
            return when (code) {
                SmsManager.RESULT_ERROR_GENERIC_FAILURE -> "RESULT_ERROR_GENERIC_FAILURE"
                SmsManager.RESULT_ERROR_NO_SERVICE -> "RESULT_ERROR_NO_SERVICE"
                SmsManager.RESULT_ERROR_NULL_PDU -> "RESULT_ERROR_NULL_PDU"
                SmsManager.RESULT_ERROR_RADIO_OFF -> "RESULT_ERROR_RADIO_OFF"
                else -> "SMS_RESULT_CODE_$code"
            }
        }
    }
}
