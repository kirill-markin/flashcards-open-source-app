package com.flashcardsopensourceapp.feature.settings.access

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver

private const val accessPreferencesName: String = "android-access-permissions"

fun accessCapabilityTitle(
    capability: AccessCapability,
    strings: SettingsStringResolver
): String {
    return when (capability) {
        AccessCapability.CAMERA -> strings.get(R.string.settings_access_camera_title)
        AccessCapability.MICROPHONE -> strings.get(R.string.settings_access_microphone_title)
        AccessCapability.PHOTOS -> strings.get(R.string.settings_access_photos_title)
        AccessCapability.FILES -> strings.get(R.string.settings_access_files_title)
    }
}

fun accessCapabilitySummary(
    capability: AccessCapability,
    strings: SettingsStringResolver
): String {
    return when (capability) {
        AccessCapability.CAMERA -> strings.get(R.string.settings_access_camera_summary)
        AccessCapability.MICROPHONE -> strings.get(R.string.settings_access_microphone_summary)
        AccessCapability.PHOTOS -> strings.get(R.string.settings_access_photos_summary)
        AccessCapability.FILES -> strings.get(R.string.settings_access_files_summary)
    }
}

fun accessCapabilityGuidance(
    capability: AccessCapability,
    status: AccessStatus,
    strings: SettingsStringResolver
): String {
    return when (capability) {
        AccessCapability.CAMERA -> when (status) {
            AccessStatus.ALLOWED -> strings.get(R.string.settings_access_camera_guidance_allowed)
            AccessStatus.ASK_EVERY_TIME -> strings.get(R.string.settings_access_camera_guidance_request)
            AccessStatus.BLOCKED -> strings.get(R.string.settings_access_camera_guidance_blocked)
            AccessStatus.SYSTEM_PICKER -> strings.get(R.string.settings_access_camera_guidance_system_picker)
            AccessStatus.UNAVAILABLE -> strings.get(R.string.settings_access_camera_guidance_unavailable)
        }
        AccessCapability.MICROPHONE -> when (status) {
            AccessStatus.ALLOWED -> strings.get(R.string.settings_access_microphone_guidance_allowed)
            AccessStatus.ASK_EVERY_TIME -> strings.get(R.string.settings_access_microphone_guidance_request)
            AccessStatus.BLOCKED -> strings.get(R.string.settings_access_microphone_guidance_blocked)
            AccessStatus.SYSTEM_PICKER -> strings.get(R.string.settings_access_microphone_guidance_system_picker)
            AccessStatus.UNAVAILABLE -> strings.get(R.string.settings_access_microphone_guidance_unavailable)
        }
        AccessCapability.PHOTOS -> strings.get(R.string.settings_access_photos_guidance)
        AccessCapability.FILES -> strings.get(R.string.settings_access_files_guidance)
    }
}

fun accessCapabilityPrimaryActionLabel(
    status: AccessStatus,
    strings: SettingsStringResolver
): String? {
    return when (status) {
        AccessStatus.ASK_EVERY_TIME -> strings.get(R.string.settings_access_request_access)
        AccessStatus.BLOCKED -> strings.get(R.string.settings_access_open_app_settings)
        AccessStatus.ALLOWED -> strings.get(R.string.settings_access_open_app_settings)
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
