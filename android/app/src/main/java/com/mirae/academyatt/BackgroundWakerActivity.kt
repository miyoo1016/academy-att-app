package com.mirae.academyatt

import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * BackgroundWakerActivity - 투명 액티비티
 * 
 * 안드로이드 시스템이 앱을 깊은 잠(Doze/Deep Sleep)에 빠뜨렸을 때,
 * 화면을 띄우지 않고도 프로세스를 확실하게 깨우기 위한 용도입니다.
 * 
 * 1. 투명한 테마로 실행되어 사용자 눈에 보이지 않음
 * 2. 실행 즉시 백그라운드 서비스를 시작시키고
 * 3. 0.1초 만에 스스로 종료(finish)함
 */
class BackgroundWakerActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        Log.i("BackgroundWaker", "🚀 투명 깨우기 액티비티 실행")
        
        // 1. 네이티브 감시 서비스와 백그라운드 태스크 시작
        try {
            SmsWatchdogService.start(this)
            // Headless JS 복구 서비스도 함께 시도
            val serviceIntent = android.content.Intent(this, SilentRecoveryService::class.java)
            startService(serviceIntent)
        } catch (e: Exception) {
            Log.e("BackgroundWaker", "서비스 시작 실패: ${e.message}")
        }

        // 2. 사용자에게 보이지 않도록 즉시 종료
        Handler(Looper.getMainLooper()).postDelayed({
            moveTaskToBack(true)
            finish()
            // 애니메이션 없이 종료
            overridePendingTransition(0, 0)
        }, 100)
    }

    override fun onPause() {
        super.onPause()
        overridePendingTransition(0, 0)
    }
}
