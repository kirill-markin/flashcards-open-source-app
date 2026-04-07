package com.flashcardsopensourceapp.app

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.os.ParcelFileDescriptor
import androidx.core.app.NotificationManagerCompat
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
import com.flashcardsopensourceapp.app.notifications.hasNotificationPermission
import com.flashcardsopensourceapp.app.notifications.showReviewReminderNotification
import com.flashcardsopensourceapp.core.ui.VisibleAppScreen
import com.flashcardsopensourceapp.feature.review.reviewCurrentCardTag
import com.flashcardsopensourceapp.feature.review.reviewEmptyStateTag
import java.io.BufferedReader
import java.io.InputStreamReader

private const val notificationPermissionUserFixedFlag: String = "user-fixed"
private const val notificationPermissionUserSetFlag: String = "user-set"

internal fun LiveSmokeContext.grantNotificationPermissionOrThrow(context: Context) {
    val packageName = context.packageName
    runInstrumentationShellCommand(
        command = "pm grant $packageName ${Manifest.permission.POST_NOTIFICATIONS}"
    )
    runInstrumentationShellCommand(
        command = "pm set-permission-flags $packageName ${Manifest.permission.POST_NOTIFICATIONS} $notificationPermissionUserSetFlag"
    )
    runInstrumentationShellCommand(
        command = "pm clear-permission-flags $packageName ${Manifest.permission.POST_NOTIFICATIONS} $notificationPermissionUserFixedFlag"
    )

    if (hasNotificationPermission(context = context).not()) {
        throw AssertionError("Failed to grant POST_NOTIFICATIONS for package '$packageName'.")
    }
}

internal fun LiveSmokeContext.clearAppNotifications(context: Context) {
    NotificationManagerCompat.from(context).cancelAll()
    waitForNotificationCondition(
        timeoutMillis = externalUiTimeoutMillis,
        context = "while clearing app notifications"
    ) {
        activeNotificationIds(context = context).isEmpty()
    }
}

internal fun LiveSmokeContext.pressHomeAndWaitForLauncher() {
    val didPressHome = device.pressHome()
    if (didPressHome.not()) {
        runInstrumentationShellCommand(command = "input keyevent KEYCODE_HOME")
    }

    val launcherPackageName = resolveHomeLauncherPackageNameOrThrow()
    waitForLauncherPackageAfterHomeOrThrow(launcherPackageName = launcherPackageName)
}

internal fun LiveSmokeContext.postReviewReminderNotification(
    context: Context,
    frontText: String,
    requestId: String
): Int {
    val notificationId = showReviewReminderNotification(
        context = context,
        frontText = frontText,
        requestId = requestId
    )
    waitForNotificationCondition(
        timeoutMillis = externalUiTimeoutMillis,
        context = "while waiting for posted review notification '$requestId'"
    ) {
        activeNotificationIds(context = context).contains(notificationId)
    }
    return notificationId
}

internal fun LiveSmokeContext.activeAppNotificationIds(context: Context): Set<Int> {
    return activeNotificationIds(context = context)
}

internal fun LiveSmokeContext.openNotificationShadeAndTap(frontText: String) {
    val didOpenNotificationShade = device.openNotification()
    if (didOpenNotificationShade.not()) {
        throw AssertionError("Failed to open the Android notification shade.")
    }

    val didShowNotification = device.wait(
        Until.hasObject(By.text(frontText)),
        externalUiTimeoutMillis
    )
    if (didShowNotification.not()) {
        throw AssertionError("Notification marker text '$frontText' did not appear in the notification shade.")
    }

    val notificationManager = composeRule.activity.getSystemService(NotificationManager::class.java)
    val statusBarNotification = notificationManager.activeNotifications.firstOrNull { notification ->
        notification.notification.matchesFrontText(frontText = frontText)
    } ?: throw AssertionError(
        "Notification marker text '$frontText' was visible in the system shade but no matching active notification could be resolved."
    )
    val contentIntent = statusBarNotification.notification.contentIntent
        ?: throw AssertionError("Review reminder notification '$frontText' did not provide a contentIntent.")
    contentIntent.send()
}

internal fun LiveSmokeContext.waitForAppToReachForeground(packageName: String) {
    val didReachForeground = device.wait(
        Until.hasObject(By.pkg(packageName).depth(0)),
        externalUiTimeoutMillis
    )
    if (didReachForeground.not()) {
        throw AssertionError("Package '$packageName' did not reach the foreground after tapping the notification.")
    }
}

internal fun LiveSmokeContext.waitForReviewScreenAfterNotificationTap() {
    waitForFlowValue(
        timeoutMillis = externalUiTimeoutMillis,
        context = "while waiting for review to become the visible app screen",
        flow = appGraph().visibleAppScreenController.observeVisibleAppScreen()
    ) { screen ->
        screen == VisibleAppScreen.REVIEW
    }
    waitUntilWithMitigation(
        timeoutMillis = internalUiTimeoutMillis,
        context = "while waiting for review content after tapping the notification"
    ) {
        countNodesWithTagInAnySemanticsTree(tag = reviewEmptyStateTag) > 0 ||
            countNodesWithTagInAnySemanticsTree(tag = reviewCurrentCardTag) > 0
    }
}

private fun activeNotificationIds(context: Context): Set<Int> {
    val notificationManager = context.getSystemService(NotificationManager::class.java)
    return notificationManager.activeNotifications
        .map { statusBarNotification -> statusBarNotification.id }
        .toSet()
}

private fun Notification.matchesFrontText(frontText: String): Boolean {
    val extras = extras
    val contentText = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
    val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
    return contentText == frontText || bigText == frontText
}

private fun resolveHomeLauncherPackageNameOrThrow(): String {
    val shellOutput = runInstrumentationShellCommand(
        command = "cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME"
    )
    val resolvedActivityLine = shellOutput.lineSequence()
        .map { line -> line.trim() }
        .lastOrNull { line -> line.contains("/") }
        ?: throw AssertionError(
            "Failed to resolve the Android HOME activity package before notification smoke. shellOutput=$shellOutput"
        )
    return resolvedActivityLine.substringBefore("/")
        .takeIf { packageName -> packageName.isNotBlank() }
        ?: throw AssertionError(
            "Resolved Android HOME activity without a valid package name before notification smoke. shellOutput=$shellOutput"
        )
}

private fun LiveSmokeContext.waitForLauncherPackageAfterHomeOrThrow(launcherPackageName: String) {
    val launcherSelector = By.pkg(launcherPackageName).depth(0)
    val deadlineMillis = System.currentTimeMillis() + externalUiTimeoutMillis

    while (System.currentTimeMillis() < deadlineMillis) {
        dismissExternalSystemDialogIfPresent()
        if (device.hasObject(launcherSelector)) {
            return
        }
        Thread.sleep(100L)
    }

    val blockingSystemDialogSummary = currentBlockingSystemDialogSummaryOrNull() ?: "none"
    throw AssertionError(
        "Launcher package '$launcherPackageName' did not appear after pressing Home. " +
            "blockingSystemDialog=$blockingSystemDialogSummary"
    )
}

private fun waitForNotificationCondition(
    timeoutMillis: Long,
    context: String,
    condition: () -> Boolean
) {
    val deadlineMillis = System.currentTimeMillis() + timeoutMillis
    while (System.currentTimeMillis() < deadlineMillis) {
        if (condition()) {
            return
        }
        Thread.sleep(100L)
    }

    throw AssertionError("Timed out $context.")
}

private fun runInstrumentationShellCommand(command: String): String {
    val shellOutput = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command)
    ParcelFileDescriptor.AutoCloseInputStream(shellOutput).use { inputStream ->
        BufferedReader(InputStreamReader(inputStream)).use { reader ->
            return reader.readText()
        }
    }
}
