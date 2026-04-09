package com.flashcardsopensourceapp.feature.settings

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

fun accountDeletionConfirmationText(strings: SettingsStringResolver): String {
    return strings.get(R.string.settings_account_danger_zone_confirmation_phrase)
}

fun workspaceResetProgressConfirmationText(strings: SettingsStringResolver): String {
    return strings.get(R.string.settings_workspace_reset_confirmation_phrase)
}

fun openExternalUrl(context: Context, url: String) {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
}

fun sendSupportEmail(context: Context, emailAddress: String) {
    val intent = Intent(
        Intent.ACTION_SENDTO,
        Uri.parse("mailto:$emailAddress")
    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
}

fun formatTimestampLabel(timestampMillis: Long?, strings: SettingsStringResolver): String {
    if (timestampMillis == null) {
        return strings.get(R.string.settings_never)
    }

    return DateTimeFormatter
        .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
        .withLocale(strings.locale())
        .format(
            Instant.ofEpochMilli(timestampMillis).atZone(ZoneId.systemDefault())
        )
}

fun currentOperatingSystemLabel(strings: SettingsStringResolver): String {
    return strings.get(
        R.string.settings_device_os_format,
        Build.VERSION.RELEASE,
        Build.VERSION.SDK_INT
    )
}

fun currentDeviceModelLabel(strings: SettingsStringResolver): String {
    return listOf(Build.MANUFACTURER, Build.MODEL)
        .map(String::trim)
        .filter(String::isNotEmpty)
        .joinToString(separator = " ")
        .ifEmpty { strings.get(R.string.settings_unavailable) }
}
