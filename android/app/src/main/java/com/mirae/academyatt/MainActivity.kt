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
        val action = intent?.action
        val isLauncher = action == Intent.ACTION_MAIN && intent.hasCategory(Intent.CATEGORY_LAUNCHER)
        
        // [근본적 해결] 사용자가 직접 아이콘을 누른 것이 아니면 즉시 종료/숨김
        // 시스템이나 서비스가 실수로라도 화면을 깨우는 것을 원천 차단합니다.
        if (!isLauncher && action != Intent.ACTION_VIEW) {
            Log.w(TAG, "❌ 비정상 실행 감지 (Action: $action) → 흔적 없이 제거")
            window.setWindowAnimations(0)
            moveTaskToBack(true)
            finishAndRemoveTask() // 시스템 자동 재시작 방지 핵심
            return
        }
        
        Log.d(TAG, "✅ 사용자 실행 확인 (Action: $action)")
        setTheme(R.style.AppTheme)
        super.onCreate(savedInstanceState)
        intent?.let { handleIntent(it) }
    }

    override fun onStart() {
        super.onStart()
        if (intent?.getBooleanExtra("is_background_launch", false) == true) {
            moveTaskToBack(true)
        }
    }

    override fun onResume() {
        super.onResume()
        Log.d(TAG, "MainActivity onResume - isBackground: ${intent?.getBooleanExtra("is_background_launch", false)}")
        if (intent?.getBooleanExtra("is_background_launch", false) == true) {
            moveTaskToBack(true)
        }
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
