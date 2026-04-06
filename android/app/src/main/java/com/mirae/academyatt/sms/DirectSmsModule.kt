package com.mirae.academyatt.sms

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
            // Android 11+ (API 30+) 에서는 Context를 통해 SmsManager를 가져와야 합니다.
            val smsManager: SmsManager = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                reactApplicationContext.getSystemService(SmsManager::class.java)
            } else {
                SmsManager.getDefault()
            }
            
            // 장문 메시지 처리 (필요시 divideMessage 사용)
            if (message.length > 70) {
                val parts = smsManager.divideMessage(message)
                smsManager.sendMultipartTextMessage(phoneNumber, null, parts, null, null)
            } else {
                smsManager.sendTextMessage(phoneNumber, null, message, null, null)
            }
            
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SMS_ERROR", e.message, e)
        }
    }
}
