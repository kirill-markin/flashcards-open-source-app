package com.flashcardsopensourceapp.app.notifications

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

fun hasNotificationPermission(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }
    return ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.POST_NOTIFICATIONS
    ) == PackageManager.PERMISSION_GRANTED
}

/**
 * Whether Android can still show its notifications permission dialog. A denied permission with no
 * rationale to show is either never asked or permanently denied, and only the install's own request
 * history tells the two apart. Below API 33 there is no runtime permission to ask for.
 */
fun canShowNotificationPermissionDialog(activity: Activity, hasRequestedSystemPermission: Boolean): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        return false
    }
    return hasRequestedSystemPermission.not() ||
        activity.shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)
}
