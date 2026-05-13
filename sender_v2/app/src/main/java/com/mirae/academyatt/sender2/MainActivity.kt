package com.mirae.academyatt.sender2

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.mirae.academyatt.sender2.databinding.ActivityMainBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Admin diagnostic + control screen.
 *
 *   - Shows current FCM token registration state for device_tokens/main_phone_v2
 *   - Shows queue sweep / last-SMS status
 *   - Requests SEND_SMS + POST_NOTIFICATIONS permissions
 *   - Offers battery-optimisation exemption shortcut
 *   - Runs a foreground queue sweep loop while open
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private var sweepLoop: Job? = null

    private val smsPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        Toast.makeText(
            this,
            if (granted) "SMS 권한 허용됨" else "SMS 권한 필요",
            Toast.LENGTH_SHORT
        ).show()
    }

    private val notifPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        Toast.makeText(
            this,
            if (granted) "알림 권한 허용됨" else "알림 권한 거부됨",
            Toast.LENGTH_SHORT
        ).show()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.btnRefreshToken.setOnClickListener {
            refreshToken()
        }
        binding.btnSweep.setOnClickListener {
            sweepNow()
        }
        binding.btnRequestSms.setOnClickListener {
            requestSmsPermission()
        }
        binding.btnRequestNotif.setOnClickListener {
            requestNotificationPermission()
        }
        binding.btnBatteryOpt.setOnClickListener {
            openBatteryOptimisationSettings()
        }

        StatusStore.liveSnapshot.observe(this) { snap ->
            renderStatus(snap)
        }
        StatusStore.publish(this)

        // Auto-request permissions and refresh token on first open.
        requestSmsPermission()
        requestNotificationPermission()
        refreshToken()
    }

    override fun onResume() {
        super.onResume()
        startSweepLoop()
    }

    override fun onPause() {
        super.onPause()
        sweepLoop?.cancel()
        sweepLoop = null
    }

    private fun startSweepLoop() {
        if (sweepLoop != null) return
        sweepLoop = lifecycleScope.launch {
            while (true) {
                runCatching { QueueSweeper.runOnce(applicationContext) }
                delay(30_000L)
            }
        }
    }

    private fun refreshToken() {
        binding.txtTokenStatus.text = "FCM 토큰 갱신 중..."
        lifecycleScope.launch {
            withContext(Dispatchers.IO) {
                TokenRegistrar.refresh(applicationContext)
            }
        }
    }

    private fun sweepNow() {
        binding.txtQueueStatus.text = "큐 확인 중..."
        lifecycleScope.launch {
            withContext(Dispatchers.IO) {
                QueueSweeper.runOnce(applicationContext)
            }
        }
    }

    private fun requestSmsPermission() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            smsPermissionLauncher.launch(Manifest.permission.SEND_SMS)
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.POST_NOTIFICATIONS
                ) != PackageManager.PERMISSION_GRANTED
            ) {
                notifPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    private fun openBatteryOptimisationSettings() {
        try {
            val pm = getSystemService(POWER_SERVICE) as PowerManager
            if (pm.isIgnoringBatteryOptimizations(packageName)) {
                Toast.makeText(this, "이미 배터리 최적화 예외 상태입니다", Toast.LENGTH_SHORT).show()
                return
            }
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:$packageName")
            }
            startActivity(intent)
        } catch (e: Exception) {
            Toast.makeText(this, "설정 화면을 열 수 없습니다: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun renderStatus(snap: StatusStore.Snapshot) {
        val tokenLine = buildString {
            append(if (snap.tokenOk) "✅ FCM 토큰 등록됨" else "❌ FCM 토큰 미등록")
            append("\n  - prefix: ")
            append(if (snap.tokenPrefix.isNotBlank()) snap.tokenPrefix else "-")
            append("\n  - updatedAt: ")
            append(StatusStore.formatTimestamp(snap.tokenUpdatedAt))
            if (!snap.tokenOk && !snap.tokenError.isNullOrBlank()) {
                append("\n  - error: ")
                append(snap.tokenError)
            }
        }
        binding.txtTokenStatus.text = tokenLine

        val queueLine = buildString {
            append("마지막 큐 확인: ")
            append(StatusStore.formatTimestamp(snap.lastQueueCheckAt))
            append("\n미발송 건 수: ")
            append(snap.pendingCount)
        }
        binding.txtQueueStatus.text = queueLine

        val smsLine = buildString {
            when (snap.lastSmsSuccess) {
                null -> append("아직 발송 내역 없음")
                true -> {
                    append("✅ 마지막 SMS 성공\n  - 대상: ")
                    append(snap.lastSmsWho ?: "-")
                    append("\n  - 시각: ")
                    append(StatusStore.formatTimestamp(snap.lastSmsAt))
                }
                false -> {
                    append("⚠️ 마지막 SMS 실패\n  - 대상: ")
                    append(snap.lastSmsWho ?: "-")
                    append("\n  - 시각: ")
                    append(StatusStore.formatTimestamp(snap.lastSmsAt))
                    append("\n  - 오류: ")
                    append(snap.lastError ?: "-")
                }
            }
        }
        binding.txtSmsStatus.text = smsLine
    }
}
