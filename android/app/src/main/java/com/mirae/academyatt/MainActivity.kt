package com.mirae.academyatt

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {

  companion object {
    private const val TAG = "MainActivity"
  }

    override fun onCreate(savedInstanceState: Bundle?) {
        // 백그라운드 실행 시 애니메이션 제거
        if (intent?.getBooleanExtra("is_background_launch", false) == true) {
            window.setWindowAnimations(0)
            moveTaskToBack(true)
        }
        
        // 스플래시 화면 테마에서 기본 앱 테마로 변경
        setTheme(R.style.AppTheme)
        super.onCreate(savedInstanceState)

        Log.d(TAG, "MainActivity onCreate - intent action: ${intent?.action}")
        
        // 0.1초 후에도 살아있으면 다시 한번 숨기기 시도 (이중 안전장치)
        if (intent?.getBooleanExtra("is_background_launch", false) == true) {
            Handler(Looper.getMainLooper()).postDelayed({
                moveTaskToBack(true)
            }, 100)
        }

        intent?.let { handleIntent(it) }
    }

  /**
   * 이미 실행 중인 앱에 새 Intent가 들어올 때 (singleTask 모드)
   * SmsAlarmReceiver에서 RESTART_BG_SERVICE를 보내면 여기서 처리됨.
   */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)

        if (intent.getBooleanExtra("is_background_launch", false) == true) {
            Log.i(TAG, "시스템 자동 실행 감지 (onNewIntent) → 즉시 백그라운드 이동")
            window.setWindowAnimations(0)
            moveTaskToBack(true)
            
            // 이중 안전장치
            Handler(Looper.getMainLooper()).postDelayed({
                moveTaskToBack(true)
            }, 100)
        }
        
        handleIntent(intent)
    }

  /**
   * RESTART_BG_SERVICE 액션 처리:
   * JS 레이어에 이벤트를 보내서 SmsBackgroundService를 재시작시킴.
   *
   * 이렇게 하면 JS Thread가 재기동되고 Firebase 재연결이 이루어짐.
   */
  private fun handleIntent(intent: Intent) {
    if (intent.action == "com.mirae.academyatt.RESTART_BG_SERVICE") {
      Log.i(TAG, "🔄 RESTART_BG_SERVICE 인텐트 수신 → JS 초기화 후 백그라운드로 이동")
      
      // HeartbeatModule ping 초기화 (JS가 다시 ping하도록 유도)
      HeartbeatModule.resetPing(applicationContext)

      // [핵심] 사용자가 직접 연 것이 아니라 시스템이 복구용으로 연 것이므로 
      // JS 엔진만 깨우고 화면은 즉시 백그라운드로 숨김
      moveTaskToBack(true)
    }
  }

  override fun getMainComponentName(): String = "main"

  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              super.invokeDefaultOnBackPressed()
          }
          return
      }
      super.invokeDefaultOnBackPressed()
  }
}
