package com.flashcardsopensourceapp.feature.settings

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

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

fun formatTimestampLabel(timestampMillis: Long?): String {
    if (timestampMillis == null) {
        return "Never"
    }

    return DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(
        Instant.ofEpochMilli(timestampMillis).atZone(ZoneId.systemDefault())
    )
}

fun currentOperatingSystemLabel(): String {
    return "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})"
}

fun currentDeviceModelLabel(): String {
    return listOf(Build.MANUFACTURER, Build.MODEL)
        .map(String::trim)
        .filter(String::isNotEmpty)
        .joinToString(separator = " ")
        .ifEmpty { "Unavailable" }
}
