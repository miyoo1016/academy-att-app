package com.mirae.academyatt.sms

import android.content.Context
import android.os.Build
import android.telephony.SmsManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

class DirectSmsModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "DirectSmsModule"
    }

    @ReactMethod
    fun sendDirectSms(phoneNumber: String, message: String, promise: Promise) {
        try {
            // 코틀린의 타입 안전성을 위해 명시적으로 Nullable 처리를 합니다.
            val smsManager: SmsManager? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                reactApplicationContext.getSystemService(SmsManager::class.java)
            } else {
                @Suppress("DEPRECATION")
                SmsManager.getDefault()
            }
            
            if (smsManager == null) {
                promise.reject("SMS_ERROR", "SmsManager instance is null")
                return
            }

            // 한글 포함 시 SMS 길이를 고려하여 안전하게 70자 기준으로 분할 전송
            if (message.length > 70) {
                val parts = smsManager.divideMessage(message)
                smsManager.sendMultipartTextMessage(phoneNumber, null, parts, null, null)
            } else {
                smsManager.sendTextMessage(phoneNumber, null, message, null, null)
            }
            
            promise.resolve(true)
        } catch (e: Exception) {
            // 상세한 오류 메시지를 반환하여 디버깅을 돕습니다.
            promise.reject("SMS_ERROR", e.localizedMessage ?: e.toString(), e)
        }
    }
}
