package com.mirae.academyatt

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
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
        
        // ⭐ 핵심: super.onCreate() 호출 전에 NoDisplay 테마 적용
        // 이렇게 해야 시스템이 윈도우를 그리지 않음 (splash 차단)
        if (!isLauncher) {
            setTheme(android.R.style.Theme_NoDisplay)
            super.onCreate(savedInstanceState)
            finish()
            overridePendingTransition(0, 0)
            return
        }
        
        // 정상 경로 (사용자가 아이콘 직접 클릭)
        Log.d(TAG, "✅ 사용자 실행 확인 (Action: $action)")
        setTheme(R.style.AppTheme)
        super.onCreate(savedInstanceState)
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
