package com.mirae.academyatt.sender2

import android.content.Context
import androidx.lifecycle.MutableLiveData
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Persists the latest token-registration / queue / SMS status so that
 * MainActivity can render it after process restart.
 *
 * All timestamps are written as epoch millis; the activity formats them
 * with [formatTimestamp] before display.
 */
object StatusStore {

    private const val PREFS = "academy_sender_v2_status"

    private const val KEY_TOKEN_OK = "token_ok"
    private const val KEY_TOKEN_PREFIX = "token_prefix"
    private const val KEY_TOKEN_UPDATED = "token_updated"
    private const val KEY_TOKEN_ERROR = "token_error"

    private const val KEY_LAST_QUEUE_CHECK = "last_queue_check"
    private const val KEY_PENDING_COUNT = "pending_count"

    private const val KEY_LAST_SMS_OK = "last_sms_ok"
    private const val KEY_LAST_SMS_AT = "last_sms_at"
    private const val KEY_LAST_SMS_WHO = "last_sms_who"
    private const val KEY_LAST_ERROR = "last_error"

    data class Snapshot(
        val tokenOk: Boolean,
        val tokenPrefix: String,
        val tokenUpdatedAt: Long,
        val tokenError: String?,
        val lastQueueCheckAt: Long,
        val pendingCount: Int,
        val lastSmsSuccess: Boolean?,
        val lastSmsAt: Long,
        val lastSmsWho: String?,
        val lastError: String?
    )

    val liveSnapshot = MutableLiveData<Snapshot>()

    fun recordTokenSuccess(context: Context, fullToken: String) {
        val prefix = if (fullToken.length >= 10) fullToken.substring(0, 10) else fullToken
        prefs(context).edit()
            .putBoolean(KEY_TOKEN_OK, true)
            .putString(KEY_TOKEN_PREFIX, prefix)
            .putLong(KEY_TOKEN_UPDATED, System.currentTimeMillis())
            .remove(KEY_TOKEN_ERROR)
            .apply()
        publish(context)
    }

    fun recordTokenFailure(context: Context, error: String) {
        prefs(context).edit()
            .putBoolean(KEY_TOKEN_OK, false)
            .putString(KEY_TOKEN_ERROR, error)
            .putLong(KEY_TOKEN_UPDATED, System.currentTimeMillis())
            .apply()
        publish(context)
    }

    fun recordQueueCheck(context: Context, pendingCount: Int) {
        prefs(context).edit()
            .putLong(KEY_LAST_QUEUE_CHECK, System.currentTimeMillis())
            .putInt(KEY_PENDING_COUNT, pendingCount)
            .apply()
        publish(context)
    }

    fun recordSmsSuccess(context: Context, who: String) {
        prefs(context).edit()
            .putBoolean(KEY_LAST_SMS_OK, true)
            .putLong(KEY_LAST_SMS_AT, System.currentTimeMillis())
            .putString(KEY_LAST_SMS_WHO, who)
            .remove(KEY_LAST_ERROR)
            .apply()
        publish(context)
    }

    fun recordSmsFailure(context: Context, who: String, error: String) {
        prefs(context).edit()
            .putBoolean(KEY_LAST_SMS_OK, false)
            .putLong(KEY_LAST_SMS_AT, System.currentTimeMillis())
            .putString(KEY_LAST_SMS_WHO, who)
            .putString(KEY_LAST_ERROR, error)
            .apply()
        publish(context)
    }

    fun publish(context: Context) {
        liveSnapshot.postValue(read(context))
    }

    fun read(context: Context): Snapshot {
        val p = prefs(context)
        val hasSms = p.contains(KEY_LAST_SMS_OK)
        return Snapshot(
            tokenOk = p.getBoolean(KEY_TOKEN_OK, false),
            tokenPrefix = p.getString(KEY_TOKEN_PREFIX, "") ?: "",
            tokenUpdatedAt = p.getLong(KEY_TOKEN_UPDATED, 0L),
            tokenError = p.getString(KEY_TOKEN_ERROR, null),
            lastQueueCheckAt = p.getLong(KEY_LAST_QUEUE_CHECK, 0L),
            pendingCount = p.getInt(KEY_PENDING_COUNT, 0),
            lastSmsSuccess = if (hasSms) p.getBoolean(KEY_LAST_SMS_OK, false) else null,
            lastSmsAt = p.getLong(KEY_LAST_SMS_AT, 0L),
            lastSmsWho = p.getString(KEY_LAST_SMS_WHO, null),
            lastError = p.getString(KEY_LAST_ERROR, null)
        )
    }

    fun formatTimestamp(epochMs: Long): String {
        if (epochMs <= 0L) return "-"
        val fmt = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.KOREA)
        return fmt.format(Date(epochMs))
    }

    fun toJson(snapshot: Snapshot): String {
        val obj = JSONObject()
        obj.put("tokenOk", snapshot.tokenOk)
        obj.put("tokenPrefix", snapshot.tokenPrefix)
        obj.put("tokenUpdatedAt", snapshot.tokenUpdatedAt)
        obj.put("tokenError", snapshot.tokenError ?: JSONObject.NULL)
        obj.put("lastQueueCheckAt", snapshot.lastQueueCheckAt)
        obj.put("pendingCount", snapshot.pendingCount)
        obj.put("lastSmsSuccess", snapshot.lastSmsSuccess ?: JSONObject.NULL)
        obj.put("lastSmsAt", snapshot.lastSmsAt)
        obj.put("lastSmsWho", snapshot.lastSmsWho ?: JSONObject.NULL)
        obj.put("lastError", snapshot.lastError ?: JSONObject.NULL)
        return obj.toString()
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
