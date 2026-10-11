package com.flashcardsopensourceapp.core.observability

import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration

/**
 * Sent as `osName` on analytics, sync, and feedback bodies and as `X-Client-Os-Name` on AI chat.
 * `platform` stays `android` separately.
 */
const val androidClientOsName: String = "android"

/**
 * The backend validates these with a strict enum on sync and feedback, so any other value fails the
 * whole request with 400.
 */
enum class ClientDeviceType(
    val wireValue: String
) {
    PHONE(wireValue = "phone"),
    TABLET(wireValue = "tablet"),
    DESKTOP(wireValue = "desktop"),
    TV(wireValue = "tv")
}

private const val tabletSmallestScreenWidthDp: Int = 600

/** Read per request, so a foldable reports whichever posture it is in at that moment. */
fun currentClientDeviceType(context: Context): ClientDeviceType {
    val uiModeManager: UiModeManager = requireNotNull(context.getSystemService(UiModeManager::class.java)) {
        "UiModeManager system service is unavailable; cannot resolve the client device type."
    }
    if (uiModeManager.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION) {
        return ClientDeviceType.TV
    }
    if (context.packageManager.hasSystemFeature(PackageManager.FEATURE_PC)) {
        return ClientDeviceType.DESKTOP
    }
    if (context.resources.configuration.smallestScreenWidthDp >= tabletSmallestScreenWidthDp) {
        return ClientDeviceType.TABLET
    }
    return ClientDeviceType.PHONE
}
