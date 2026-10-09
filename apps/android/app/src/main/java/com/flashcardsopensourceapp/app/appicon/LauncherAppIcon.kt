package com.flashcardsopensourceapp.app.appicon

import android.app.ActivityManager
import android.app.KeyguardManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.PowerManager
import android.util.Log
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import com.flashcardsopensourceapp.app.observability.renderSanitizedThrowableLogFields
import com.flashcardsopensourceapp.data.local.appicon.AppIcon
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val launcherAppIconLogTag: String = "LauncherAppIcon"

/** One launcher `<activity-alias>` from AndroidManifest.xml, with its `android:enabled` value there. */
private data class LauncherAlias(
    val appIcon: AppIcon,
    val className: String,
    val isEnabledInManifest: Boolean
)

private data class LauncherAliasUpdate(
    val component: ComponentName,
    val isEnabled: Boolean
)

private val launcherAliases: List<LauncherAlias> = listOf(
    LauncherAlias(
        appIcon = AppIcon.DEFAULT,
        className = "com.flashcardsopensourceapp.app.MainActivity",
        isEnabledInManifest = true
    ),
    LauncherAlias(
        appIcon = AppIcon.LIGHT,
        className = "com.flashcardsopensourceapp.app.MainActivityLight",
        isEnabledInManifest = false
    )
)

/**
 * Leaves exactly the launcher alias for [appIcon] enabled, once the person has left the app.
 * Disabling the alias that started a task makes the system remove that task, so the switch is
 * deferred to a later call while the app is in the foreground, while the screen is off or locked,
 * or while another app's activity opened into the app's own task (document picker, camera, share
 * sheet) is on top. Screens the app opens in their own task (browser, mail, system settings) and a
 * full-screen call or alarm count as leaving the app, so returning from them right after a change
 * may cold-start the app. The new alias is enabled before the old one is disabled, so the app never
 * has zero launcher entries. A failure is logged, not thrown: the launcher keeps its current icon
 * until the next sync.
 */
internal suspend fun syncLauncherAppIcon(context: Context, appIcon: AppIcon) {
    val updates: List<LauncherAliasUpdate> = try {
        pendingLauncherAliasUpdates(context = context, appIcon = appIcon)
    } catch (error: RuntimeException) {
        logLauncherAppIconSyncFailed(appIcon = appIcon, error = error)
        return
    }
    if (updates.isEmpty()) {
        return
    }
    // Process lifecycle events are dispatched on the main thread, so the app's lifecycle state
    // cannot change between the checks and the switch.
    withContext(Dispatchers.Main.immediate) {
        applyLauncherAliasUpdatesIfAppLeft(context = context, appIcon = appIcon, updates = updates)
    }
}

private fun pendingLauncherAliasUpdates(context: Context, appIcon: AppIcon): List<LauncherAliasUpdate> {
    val packageManager: PackageManager = context.packageManager
    return launcherAliases
        .sortedBy { alias -> alias.appIcon != appIcon }
        .mapNotNull { alias ->
            val component = ComponentName(context, alias.className)
            val isEnabled: Boolean = alias.appIcon == appIcon
            val isCurrentlyEnabled: Boolean = when (packageManager.getComponentEnabledSetting(component)) {
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
                PackageManager.COMPONENT_ENABLED_STATE_DEFAULT -> alias.isEnabledInManifest
                else -> false
            }
            if (isCurrentlyEnabled == isEnabled) {
                null
            } else {
                LauncherAliasUpdate(component = component, isEnabled = isEnabled)
            }
        }
}

private fun applyLauncherAliasUpdatesIfAppLeft(
    context: Context,
    appIcon: AppIcon,
    updates: List<LauncherAliasUpdate>
) {
    try {
        if (ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
            logLauncherAppIconSyncDeferred(appIcon = appIcon, reason = "app_in_foreground")
            return
        }
        if (isScreenOffOrLocked(context = context)) {
            logLauncherAppIconSyncDeferred(appIcon = appIcon, reason = "screen_off")
            return
        }
        if (hasOtherAppActivityOnTopOfAppTask(context = context)) {
            logLauncherAppIconSyncDeferred(appIcon = appIcon, reason = "other_app_activity_on_top")
            return
        }
        updates.forEach { update ->
            context.packageManager.setComponentEnabledSetting(
                update.component,
                if (update.isEnabled) {
                    PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                } else {
                    PackageManager.COMPONENT_ENABLED_STATE_DISABLED
                },
                PackageManager.DONT_KILL_APP
            )
        }
    } catch (error: RuntimeException) {
        logLauncherAppIconSyncFailed(appIcon = appIcon, error = error)
    }
}

/** Turning the screen off stops the app without the person leaving it. */
private fun isScreenOffOrLocked(context: Context): Boolean {
    val powerManager: PowerManager = checkNotNull(context.getSystemService(PowerManager::class.java)) {
        "PowerManager system service is unavailable."
    }
    val keyguardManager: KeyguardManager = checkNotNull(context.getSystemService(KeyguardManager::class.java)) {
        "KeyguardManager system service is unavailable."
    }
    return !powerManager.isInteractive || keyguardManager.isKeyguardLocked
}

/**
 * A task without task info or without running activities reports no top activity and is ignored.
 * The platform may report another app's top activity as an empty component name, which still counts as foreign.
 */
private fun hasOtherAppActivityOnTopOfAppTask(context: Context): Boolean {
    val activityManager: ActivityManager = checkNotNull(context.getSystemService(ActivityManager::class.java)) {
        "ActivityManager system service is unavailable."
    }
    return activityManager.appTasks.any { appTask ->
        val topActivity: ComponentName? = appTask.taskInfo?.topActivity
        topActivity != null && topActivity.packageName != context.packageName
    }
}

private fun logLauncherAppIconSyncDeferred(appIcon: AppIcon, reason: String) {
    Log.i(
        launcherAppIconLogTag,
        "event=launcher_app_icon_sync_deferred appIcon=${appIcon.storageValue} reason=$reason"
    )
}

private fun logLauncherAppIconSyncFailed(appIcon: AppIcon, error: RuntimeException) {
    Log.w(
        launcherAppIconLogTag,
        "event=launcher_app_icon_sync_failed appIcon=${appIcon.storageValue} " +
            renderSanitizedThrowableLogFields(error = error)
    )
}
