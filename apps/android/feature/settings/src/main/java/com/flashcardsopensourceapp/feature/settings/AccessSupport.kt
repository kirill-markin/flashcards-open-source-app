package com.flashcardsopensourceapp.feature.settings

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

private const val accessPreferencesName: String = "android-access-permissions"

fun accessCapabilityTitle(capability: AccessCapability): String {
    return when (capability) {
        AccessCapability.CAMERA -> "Camera"
        AccessCapability.MICROPHONE -> "Microphone"
        AccessCapability.PHOTOS -> "Photos"
        AccessCapability.FILES -> "Files"
    }
}

fun accessCapabilitySummary(capability: AccessCapability): String {
    return when (capability) {
        AccessCapability.CAMERA -> "Take photos directly from Android AI flows."
        AccessCapability.MICROPHONE -> "Dictate text into Android AI flows."
        AccessCapability.PHOTOS -> "Choose images through the Android system photo picker."
        AccessCapability.FILES -> "Choose documents through the Android system file picker."
    }
}

fun accessCapabilityGuidance(capability: AccessCapability, status: AccessStatus): String {
    return when (capability) {
        AccessCapability.CAMERA -> when (status) {
            AccessStatus.ALLOWED -> "Camera access is available. You can turn it off later from Android app settings."
            AccessStatus.ASK_EVERY_TIME -> "Request camera access when you are ready to take a photo from Android."
            AccessStatus.BLOCKED -> "Camera access is blocked for this app. Open Android app settings to allow it again."
            AccessStatus.SYSTEM_PICKER -> "Camera uses a direct Android permission flow."
            AccessStatus.UNAVAILABLE -> "This device does not report camera hardware."
        }
        AccessCapability.MICROPHONE -> when (status) {
            AccessStatus.ALLOWED -> "Microphone access is available. You can turn it off later from Android app settings."
            AccessStatus.ASK_EVERY_TIME -> "Request microphone access when you are ready to dictate text from Android."
            AccessStatus.BLOCKED -> "Microphone access is blocked for this app. Open Android app settings to allow it again."
            AccessStatus.SYSTEM_PICKER -> "Microphone uses a direct Android permission flow."
            AccessStatus.UNAVAILABLE -> "This device does not report microphone hardware."
        }
        AccessCapability.PHOTOS -> "Android 14+ uses the system photo picker here, so broad storage access is not required."
        AccessCapability.FILES -> "Android uses the system document picker here, so broad storage access is not required."
    }
}

fun accessCapabilityPrimaryActionLabel(status: AccessStatus): String? {
    return when (status) {
        AccessStatus.ASK_EVERY_TIME -> "Request access"
        AccessStatus.BLOCKED -> "Open app settings"
        AccessStatus.ALLOWED -> "Open app settings"
        AccessStatus.SYSTEM_PICKER,
        AccessStatus.UNAVAILABLE -> null
    }
}

fun accessCapabilityPermission(capability: AccessCapability): String? {
    return when (capability) {
        AccessCapability.CAMERA -> Manifest.permission.CAMERA
        AccessCapability.MICROPHONE -> Manifest.permission.RECORD_AUDIO
        AccessCapability.PHOTOS,
        AccessCapability.FILES -> null
    }
}

fun resolveAccessStatus(
    activity: ComponentActivity,
    capability: AccessCapability,
    hasRequestedPermission: Boolean
): AccessStatus {
    return when (capability) {
        AccessCapability.CAMERA -> resolveRuntimePermissionStatus(
            context = activity,
            activity = activity,
            permission = Manifest.permission.CAMERA,
            hasRequestedPermission = hasRequestedPermission,
            isAvailable = activity.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
        )
        AccessCapability.MICROPHONE -> resolveRuntimePermissionStatus(
            context = activity,
            activity = activity,
            permission = Manifest.permission.RECORD_AUDIO,
            hasRequestedPermission = hasRequestedPermission,
            isAvailable = activity.packageManager.hasSystemFeature(PackageManager.FEATURE_MICROPHONE)
        )
        AccessCapability.PHOTOS,
        AccessCapability.FILES -> AccessStatus.SYSTEM_PICKER
    }
}

fun hasRequestedAccessPermission(context: Context, capability: AccessCapability): Boolean {
    return context.getSharedPreferences(accessPreferencesName, Context.MODE_PRIVATE)
        .getBoolean(accessPreferenceKey(capability = capability), false)
}

fun markAccessPermissionRequested(context: Context, capability: AccessCapability) {
    context.getSharedPreferences(accessPreferencesName, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(accessPreferenceKey(capability = capability), true)
        .apply()
}

fun openApplicationSettings(context: Context) {
    val intent = Intent(
        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
        Uri.fromParts("package", context.packageName, null)
    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
}

private fun accessPreferenceKey(capability: AccessCapability): String {
    return "requested-${capability.name.lowercase()}"
}

private fun resolveRuntimePermissionStatus(
    context: Context,
    activity: ComponentActivity,
    permission: String,
    hasRequestedPermission: Boolean,
    isAvailable: Boolean
): AccessStatus {
    return resolveRuntimePermissionStatus(
        isAvailable = isAvailable,
        isGranted = ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED,
        shouldShowRationale = ActivityCompat.shouldShowRequestPermissionRationale(activity, permission),
        hasRequestedPermission = hasRequestedPermission
    )
}

internal fun resolveRuntimePermissionStatus(
    isAvailable: Boolean,
    isGranted: Boolean,
    shouldShowRationale: Boolean,
    hasRequestedPermission: Boolean
): AccessStatus {
    if (isAvailable.not()) {
        return AccessStatus.UNAVAILABLE
    }

    if (isGranted) {
        return AccessStatus.ALLOWED
    }

    if (shouldShowRationale || hasRequestedPermission.not()) {
        return AccessStatus.ASK_EVERY_TIME
    }

    return AccessStatus.BLOCKED
}
