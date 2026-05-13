package com.mirae.academyatt.sender2

import android.content.Context
import android.util.Log
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.tasks.await

/**
 * Handles registration of the V2 admin phone FCM token to
 * `device_tokens/main_phone_v2` in Firestore.
 *
 * Cloud Functions read this exact document path first and only fall back to
 * the legacy `main_phone` when this one is missing or invalid.
 */
object TokenRegistrar {

    private const val TAG = "TokenRegistrar"
    private const val DOC_PATH_COLLECTION = "device_tokens"
    private const val DOC_PATH_ID = "main_phone_v2"
    private const val PACKAGE = "com.mirae.academyatt.sender2"
    private const val SOURCE = "admin_sender_v2"

    /**
     * Force-fetches a fresh token via Firebase Messaging then persists it.
     * Returns the token on success, null on failure (with reason recorded
     * in StatusStore).
     */
    suspend fun refresh(context: Context): String? {
        return try {
            val token = FirebaseMessaging.getInstance().token.await()
            if (token.isBlank()) {
                Log.w(TAG, "Token from FirebaseMessaging is empty")
                StatusStore.recordTokenFailure(context, "empty_token")
                null
            } else {
                register(context, token)
                token
            }
        } catch (e: Exception) {
            Log.e(TAG, "refresh failed: ${e.message}", e)
            StatusStore.recordTokenFailure(context, e.message ?: "refresh_exception")
            null
        }
    }

    /**
     * Persists [token] to Firestore. Always writes invalid=false so that
     * any earlier invalidation marker is cleared.
     */
    suspend fun register(context: Context, token: String) {
        try {
            val payload = mapOf(
                "token" to token,
                "platform" to "android",
                "source" to SOURCE,
                "packageName" to PACKAGE,
                "updatedAt" to FieldValue.serverTimestamp(),
                "lastActive" to FieldValue.serverTimestamp(),
                "invalid" to false,
                "invalidReason" to FieldValue.delete(),
                "invalidatedAt" to FieldValue.delete()
            )
            FirebaseFirestore.getInstance()
                .collection(DOC_PATH_COLLECTION)
                .document(DOC_PATH_ID)
                .set(payload, com.google.firebase.firestore.SetOptions.merge())
                .await()
            Log.i(TAG, "Token registered to $DOC_PATH_COLLECTION/$DOC_PATH_ID (prefix=${token.take(10)})")
            StatusStore.recordTokenSuccess(context, token)
        } catch (e: Exception) {
            Log.e(TAG, "register failed: ${e.message}", e)
            StatusStore.recordTokenFailure(context, e.message ?: "register_exception")
        }
    }
}
