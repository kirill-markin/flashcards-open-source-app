package com.flashcardsopensourceapp.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.PowerManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner

@Composable
internal fun rememberIsPowerSaveMode(): Boolean {
    val applicationContext: Context = LocalContext.current.applicationContext
    val lifecycleOwner = LocalLifecycleOwner.current
    val powerManager: PowerManager = remember(applicationContext) {
        applicationContext.getSystemService(PowerManager::class.java)
            ?: error(
                "Android PowerManager service is unavailable; " +
                    "Battery Saver state cannot be observed."
            )
    }
    var isPowerSaveMode: Boolean by remember(powerManager) {
        mutableStateOf(value = powerManager.isPowerSaveMode)
    }

    DisposableEffect(applicationContext, lifecycleOwner, powerManager) {
        fun refreshPowerSaveMode(): Unit {
            isPowerSaveMode = powerManager.isPowerSaveMode
        }

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                refreshPowerSaveMode()
            }
        }
        val lifecycleObserver = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                refreshPowerSaveMode()
            }
        }

        applicationContext.registerReceiver(
            receiver,
            IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED),
            Context.RECEIVER_NOT_EXPORTED
        )
        lifecycleOwner.lifecycle.addObserver(lifecycleObserver)
        refreshPowerSaveMode()

        onDispose {
            lifecycleOwner.lifecycle.removeObserver(lifecycleObserver)
            applicationContext.unregisterReceiver(receiver)
        }
    }

    return isPowerSaveMode
}
