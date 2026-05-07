package com.mirae.academyatt

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class SilentRecoveryService : HeadlessJsTaskService() {
    override fun getTaskConfig(intent: Intent): HeadlessJsTaskConfig? {
        return intent.extras?.let {
            HeadlessJsTaskConfig(
                "SilentRecoveryTask",
                Arguments.fromBundle(it),
                5000, // timeout for the task
                true  // allowed in foreground
            )
        } ?: HeadlessJsTaskConfig(
            "SilentRecoveryTask",
            Arguments.createMap(),
            5000,
            true
        )
    }
}
