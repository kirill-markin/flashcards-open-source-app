package com.flashcardsopensourceapp.app.automation

import android.app.ActivityManager
import android.content.ContentResolver
import android.os.Build
import android.provider.Settings
import android.util.Log
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * `FlashcardsAndroidTestRunner` reads it before the application exists, so the first app graph of
 * the process already declares automation. `apps/android/app/build.gradle.kts` sets it for every
 * Gradle-driven instrumentation run, and for Firebase Test Lab `gcloud firebase test android run
 * --environment-variables isAutomation=true` is mirrored into `am instrument -e isAutomation true`.
 */
internal const val automationDeclarationArgumentKey: String = "isAutomation"

private const val automationLogTag: String = "AutomationEnvironment"
private const val firebaseTestLabSettingName: String = "firebase.test.lab"

private val hasAutomationArgumentSignal = AtomicBoolean(false)
private val resolvedAutomationEnvironment = AtomicReference<AutomationEnvironment?>(null)

/**
 * The decision and each signal behind it, kept apart so a run that should have been marked is
 * diagnosable and so a Test Lab logcat shows whether the instrumentation argument actually arrived.
 */
internal data class AutomationEnvironment(
    val isAutomation: Boolean,
    val isEmulator: Boolean,
    val hasArgumentSignal: Boolean,
    val isFirebaseTestLabDevice: Boolean,
    val isUserTestHarness: Boolean
)

/**
 * Records the instrumentation argument signal. Called by the instrumentation runner before the
 * application exists, so the first sync of the first graph already carries the declaration.
 */
internal fun markProcessAsAutomationEnvironment() {
    hasAutomationArgumentSignal.set(true)
}

internal fun isFirebaseTestLabDevice(contentResolver: ContentResolver): Boolean {
    return Settings.System.getString(contentResolver, firebaseTestLabSettingName) == "true"
}

/**
 * The signals are memoised at the first resolve, so it must be called from
 * `Application.onCreate` or later, never from a `ContentProvider` or an `androidx.startup`
 * initializer: those run before `Instrumentation.onCreate` and would freeze the argument signal as
 * absent for the whole process.
 *
 * Test Harness Mode does not identify ordinary instrumentation, so the argument signal remains
 * necessary for physical-device runs outside a device farm. Each signal is logged on its own,
 * because a device-farm signal would otherwise hide a dropped argument.
 */
internal fun resolveAutomationEnvironment(contentResolver: ContentResolver): AutomationEnvironment {
    resolvedAutomationEnvironment.get()?.let { alreadyResolved -> return alreadyResolved }

    val isEmulator = isEmulatorBuild()
    val hasArgumentSignal = hasAutomationArgumentSignal.get()
    val isTestLabDevice = isFirebaseTestLabDevice(contentResolver = contentResolver)
    val isUserTestHarness = ActivityManager.isRunningInUserTestHarness()
    val environment = AutomationEnvironment(
        isAutomation = isEmulator || hasArgumentSignal || isTestLabDevice || isUserTestHarness,
        isEmulator = isEmulator,
        hasArgumentSignal = hasArgumentSignal,
        isFirebaseTestLabDevice = isTestLabDevice,
        isUserTestHarness = isUserTestHarness
    )
    if (resolvedAutomationEnvironment.compareAndSet(null, environment).not()) {
        return requireNotNull(resolvedAutomationEnvironment.get())
    }

    Log.i(
        automationLogTag,
        "event=automation_environment_resolved isAutomation=${environment.isAutomation} " +
            "isEmulator=${environment.isEmulator} hasArgumentSignal=${environment.hasArgumentSignal} " +
            "isFirebaseTestLabDevice=${environment.isFirebaseTestLabDevice} " +
            "isUserTestHarness=${environment.isUserTestHarness}"
    )
    return environment
}

// Only build fields an emulator image sets to a value no shipped device reports. The list is
// deliberately narrow: `FINGERPRINT`, `BRAND` and `DEVICE` checks for `generic` or `unknown` are
// left out because custom-ROM and some OEM builds report those values too, and the marker is
// sticky, so a false positive erases a real person from product analytics with no way back.
// Missing an emulator only costs that run's data counting. Only `:app` instrumentation passes the
// declaration argument, and only its custom runner reads one, so this check is the sole cover for
// `:baselineprofile`, which drives the real app on a connected emulator, and for any hand-run
// emulator install.
private fun isEmulatorBuild(): Boolean {
    return Build.HARDWARE.contains("goldfish") ||
        Build.HARDWARE.contains("ranchu") ||
        Build.HARDWARE.contains("cuttlefish") ||
        Build.HARDWARE.contains("vbox") ||
        Build.PRODUCT == "google_sdk" ||
        Build.PRODUCT.startsWith("sdk_") ||
        Build.PRODUCT.startsWith("vbox") ||
        Build.MODEL.contains("google_sdk") ||
        Build.MODEL.contains("Emulator") ||
        Build.MODEL.contains("Android SDK built for")
}
