package com.flashcardsopensourceapp.app.automation

import android.content.ContentResolver
import android.os.Build
import android.provider.Settings
import android.util.Log
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * Instrumentation argument an automation environment uses to declare itself.
 *
 * `FlashcardsAndroidTestRunner` reads it before the application exists, so the first app graph of
 * the process already declares automation. `apps/android/app/build.gradle.kts` sets it for every
 * Gradle-driven instrumentation run, and for Firebase Test Lab `gcloud firebase test android run
 * --environment-variables isAutomation=true` is mirrored into `am instrument -e isAutomation true`.
 *
 * It is the only signal for an instrumentation run against a physical device outside Test Lab,
 * where neither the emulator check nor the `firebase.test.lab` setting fires. Test Lab itself is
 * covered twice, by this argument and by that setting, so neither of the two is redundant.
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
    val isFirebaseTestLabDevice: Boolean
)

/**
 * Records the instrumentation argument signal. Called by the instrumentation runner before the
 * application exists, so the first sync of the first graph already carries the declaration.
 */
internal fun markProcessAsAutomationEnvironment() {
    hasAutomationArgumentSignal.set(true)
}

/** The setting Firebase Test Lab writes on the devices it hands out. */
internal fun isFirebaseTestLabDevice(contentResolver: ContentResolver): Boolean {
    return Settings.System.getString(contentResolver, firebaseTestLabSettingName) == "true"
}

/**
 * Decided and logged once per process, before anything syncs.
 *
 * The three signals are memoised at the first resolve, so it must be called from
 * `Application.onCreate` or later, never from a `ContentProvider` or an `androidx.startup`
 * initializer: those run before `Instrumentation.onCreate` and would freeze the argument signal as
 * absent for the whole process.
 *
 * Three signals, none of which covers the others: the emulator check sees nothing on the real
 * hardware a device farm runs on, the instrumentation argument is the only signal for a
 * physical-device run outside Test Lab, and the `firebase.test.lab` setting is what still marks a
 * Test Lab run if orchestrator argument forwarding ever breaks. Each is logged on its own, because
 * on a Test Lab device the setting alone would otherwise hide a dropped argument.
 *
 * The backend marker this feeds is sticky, so a marked installation never produces product
 * analytics again (docs/analytics-audience.md) and a false positive is unrecoverable.
 */
internal fun resolveAutomationEnvironment(contentResolver: ContentResolver): AutomationEnvironment {
    resolvedAutomationEnvironment.get()?.let { alreadyResolved -> return alreadyResolved }

    val isEmulator = isEmulatorBuild()
    val hasArgumentSignal = hasAutomationArgumentSignal.get()
    val isTestLabDevice = isFirebaseTestLabDevice(contentResolver = contentResolver)
    val environment = AutomationEnvironment(
        isAutomation = isEmulator || hasArgumentSignal || isTestLabDevice,
        isEmulator = isEmulator,
        hasArgumentSignal = hasArgumentSignal,
        isFirebaseTestLabDevice = isTestLabDevice
    )
    if (resolvedAutomationEnvironment.compareAndSet(null, environment).not()) {
        return requireNotNull(resolvedAutomationEnvironment.get())
    }

    Log.i(
        automationLogTag,
        "event=automation_environment_resolved isAutomation=${environment.isAutomation} " +
            "isEmulator=${environment.isEmulator} hasArgumentSignal=${environment.hasArgumentSignal} " +
            "isFirebaseTestLabDevice=${environment.isFirebaseTestLabDevice}"
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
