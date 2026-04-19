package com.flashcardsopensourceapp.app.livesmoke

import android.os.ParcelFileDescriptor
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.flashcardsopensourceapp.app.FlashcardsApplication
import java.io.BufferedReader
import java.io.InputStreamReader
import java.time.Instant
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout

private const val systemDialogDismissPollMillis: Long = 250L
private const val systemDialogDismissQuietPeriodMillis: Long = 3_000L

internal fun LiveSmokeContext.resetInlineRawScreenStateFailureGuard() {
    hasPrintedInlineRawScreenStateForCurrentFailure = false
}

internal fun LiveSmokeContext.emitInlineRawScreenStateIfNeeded(action: String) {
    if (hasPrintedInlineRawScreenStateForCurrentFailure) {
        return
    }

    hasPrintedInlineRawScreenStateForCurrentFailure = true
    System.err.println(inlineRawScreenStateBlock(action = action))
}

private fun LiveSmokeContext.inlineRawScreenStateBlock(action: String): String {
    val systemDialogSummary: String = currentBlockingSystemDialogSummaryOrNull() ?: "-"
    val activityName: String = composeRule.activity::class.java.simpleName
    return listOf(
        "===== BEGIN RAW SCREEN STATE =====",
        "platform: android",
        "test: ${testNameRule.methodName}",
        "step: $currentStepLabel",
        "action: $action",
        "capturedAt: ${Instant.now()}",
        "context: activity=$activityName systemDialog=$systemDialogSummary",
        "",
        "composeSemanticsTree:",
        captureComposeSemanticsTree(),
        "",
        "windowHierarchy:",
        captureWindowHierarchy(),
        "===== END RAW SCREEN STATE ====="
    ).joinToString(separator = "\n")
}

private fun LiveSmokeContext.captureComposeSemanticsTree(): String {
    return try {
        formatSemanticsNode(
            node = composeRule.onRoot(useUnmergedTree = true).fetchSemanticsNode(),
            depth = 0
        )
    } catch (error: Throwable) {
        "<compose semantics capture failed: ${error.message}>"
    }
}

private fun formatSemanticsNode(node: SemanticsNode, depth: Int): String {
    val indent: String = "  ".repeat(depth)
    val nodeLine: String = listOf(
        "${indent}- id=${node.id}",
        "bounds=${node.boundsInRoot}",
        "config=${node.config}"
    ).joinToString(separator = " ")
    val childLines: List<String> = node.children.map { child ->
        formatSemanticsNode(node = child, depth = depth + 1)
    }
    return (listOf(nodeLine) + childLines).joinToString(separator = "\n")
}

private fun LiveSmokeContext.captureWindowHierarchy(): String {
    val dumpPath: String = "/sdcard/Download/flashcards-live-smoke-window-hierarchy.xml"
    return try {
        val command: String = "uiautomator dump $dumpPath >/dev/null 2>&1 && cat $dumpPath"
        runShellCommand(command = command).ifBlank { "<empty window hierarchy dump>" }
    } catch (error: Throwable) {
        "<window hierarchy capture failed: ${error.message}>"
    }
}

internal fun <T> LiveSmokeContext.runWithInlineRawScreenStateOnFailure(
    action: String,
    operation: () -> T
): T {
    try {
        return operation()
    } catch (error: Throwable) {
        emitInlineRawScreenStateIfNeeded(action = action)
        throw error
    }
}

internal fun LiveSmokeContext.hasVisibleText(text: String, substring: Boolean): Boolean {
    return composeRule.onAllNodesWithText(text = text, substring = substring)
        .fetchSemanticsNodes()
        .isNotEmpty()
}

internal fun LiveSmokeContext.waitUntilWithMitigation(
    timeoutMillis: Long,
    context: String,
    condition: () -> Boolean
) {
    runWithInlineRawScreenStateOnFailure(action = "wait_until_with_mitigation") {
        dismissExternalSystemDialogIfPresent()
        failIfVisibleAppError(context = "before $context")
        try {
            composeRule.waitUntil(timeoutMillis = timeoutMillis) {
                dismissExternalSystemDialogIfPresent()
                condition()
            }
        } catch (error: Throwable) {
            dismissExternalSystemDialogIfPresent()
            failIfVisibleAppError(context = context)
            throw error
        }
    }
}

internal fun LiveSmokeContext.waitUntilAtLeastOneExistsOrFail(
    matcher: SemanticsMatcher,
    timeoutMillis: Long
) {
    waitUntilWithMitigation(
        timeoutMillis = timeoutMillis,
        context = "while waiting for UI state to appear"
    ) {
        composeRule.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty()
    }
}

internal fun LiveSmokeContext.waitForTagToExist(
    tag: String,
    timeoutMillis: Long,
    context: String
) {
    waitUntilWithMitigation(
        timeoutMillis = timeoutMillis,
        context = context
    ) {
        hasTagInAnySemanticsTree(tag = tag)
    }
}

internal fun LiveSmokeContext.waitForTagToDisappear(
    tag: String,
    timeoutMillis: Long,
    context: String
) {
    waitUntilWithMitigation(
        timeoutMillis = timeoutMillis,
        context = context
    ) {
        hasTagInAnySemanticsTree(tag = tag).not()
    }
}

internal fun LiveSmokeContext.waitForTextToExist(
    text: String,
    substring: Boolean,
    timeoutMillis: Long,
    context: String
) {
    waitUntilWithMitigation(
        timeoutMillis = timeoutMillis,
        context = context
    ) {
        composeRule.onAllNodesWithText(text = text, substring = substring)
            .fetchSemanticsNodes()
            .isNotEmpty()
    }
}

internal fun <T> LiveSmokeContext.waitForFlowValue(
    timeoutMillis: Long,
    context: String,
    flow: Flow<T>,
    predicate: (T) -> Boolean
): T {
    return runWithInlineRawScreenStateOnFailure(action = "wait_for_flow_value") {
        dismissExternalSystemDialogIfPresent()
        failIfVisibleAppError(context = "before $context")
        try {
            runBlocking {
                withTimeout(timeoutMillis) {
                    flow.first { value -> predicate(value) }
                }
            }
        } catch (error: Throwable) {
            dismissExternalSystemDialogIfPresent()
            failIfVisibleAppError(context = context)
            throw error
        }
    }
}

internal fun LiveSmokeContext.clickNode(matcher: SemanticsMatcher, label: String) {
    runWithInlineRawScreenStateOnFailure(action = "click_node.$label") {
        dismissExternalSystemDialogIfPresent()
        failIfVisibleAppError(context = "before clicking $label")
        composeRule.onNode(matcher = matcher).performClick()
        composeRule.waitForIdle()
        dismissExternalSystemDialogIfPresent()
        failIfVisibleAppError(context = "after clicking $label")
    }
}

internal fun LiveSmokeContext.clickText(text: String, substring: Boolean) {
    runWithInlineRawScreenStateOnFailure(action = "click_text.$text") {
        dismissExternalSystemDialogIfPresent()
        failIfVisibleAppError(context = "before clicking '$text'")
        composeRule.onNodeWithText(text = text, substring = substring).performClick()
        composeRule.waitForIdle()
        dismissExternalSystemDialogIfPresent()
        failIfVisibleAppError(context = "after clicking '$text'")
    }
}

internal fun LiveSmokeContext.clickTag(tag: String, label: String) {
    runWithInlineRawScreenStateOnFailure(action = "click_tag.$tag") {
        dismissExternalSystemDialogIfPresent()
        failIfVisibleAppError(context = "before clicking $label")
        composeRule.onNodeWithTag(tag).performClick()
        composeRule.waitForIdle()
        dismissExternalSystemDialogIfPresent()
        failIfVisibleAppError(context = "after clicking $label")
    }
}

internal fun LiveSmokeContext.countNodesWithTagInAnySemanticsTree(tag: String): Int {
    val mergedCount = composeRule.onAllNodesWithTag(tag).fetchSemanticsNodes().size
    val unmergedCount = composeRule.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().size
    return maxOf(mergedCount, unmergedCount)
}

private fun LiveSmokeContext.hasTagInAnySemanticsTree(tag: String): Boolean {
    return countNodesWithTagInAnySemanticsTree(tag = tag) > 0
}

internal fun LiveSmokeContext.clickContentDescription(contentDescription: String) {
    runWithInlineRawScreenStateOnFailure(action = "click_content_description.$contentDescription") {
        dismissExternalSystemDialogIfPresent()
        failIfVisibleAppError(context = "before clicking '$contentDescription'")
        composeRule.onNodeWithContentDescription(contentDescription).performClick()
        composeRule.waitForIdle()
        dismissExternalSystemDialogIfPresent()
        failIfVisibleAppError(context = "after clicking '$contentDescription'")
    }
}

internal fun LiveSmokeContext.failIfVisibleAppError(context: String) {
    val visibleErrors: List<String> = visibleAppErrors()
    if (visibleErrors.isNotEmpty()) {
        throw AssertionError(
            "Visible app error $context: ${visibleErrors.joinToString(separator = " || ")}"
        )
    }
}

internal fun LiveSmokeContext.visibleAppErrors(): List<String> {
    return listOfNotNull(
        currentWorkspaceVisibleErrorMessageOrNull(),
        workspaceOverviewErrorMessageOrNull()
    )
        .distinct()
}

internal fun LiveSmokeContext.tapBackIcon() {
    runWithInlineRawScreenStateOnFailure(action = "tap_back_icon") {
        dismissExternalSystemDialogIfPresent()
        failIfVisibleAppError(context = "before navigating back")
        if (composeRule.onAllNodes(matcher = hasContentDescription("Back")).fetchSemanticsNodes().isNotEmpty()) {
            composeRule.onNodeWithContentDescription("Back").performClick()
        } else {
            composeRule.activity.runOnUiThread {
                composeRule.activity.onBackPressedDispatcher.onBackPressed()
            }
            composeRule.waitForIdle()
        }
        dismissExternalSystemDialogIfPresent()
        failIfVisibleAppError(context = "after navigating back")
    }
}

internal fun nodeSummary(node: SemanticsNode): String {
    val texts: List<String> = node.config.getOrNull(SemanticsProperties.Text)
        ?.map { text -> text.text }
        ?.filter { text -> text.isNotBlank() }
        .orEmpty()
    return texts.joinToString(separator = " | ")
}

internal fun nodeSummaryIncludingDescendants(node: SemanticsNode): String {
    val texts = linkedSetOf<String>()
    collectNodeTexts(node = node, texts = texts)
    return texts.joinToString(separator = " | ")
}

private fun collectNodeTexts(node: SemanticsNode, texts: MutableSet<String>) {
    node.config.getOrNull(SemanticsProperties.Text)
        ?.map { text -> text.text.trim() }
        ?.filter { text -> text.isNotBlank() }
        ?.forEach(texts::add)
    node.children.forEach { child ->
        collectNodeTexts(node = child, texts = texts)
    }
}

internal fun UiDevice.dismissBlockingSystemDialogIfPresent(): String? {
    val initialSummary: String = currentBlockingSystemDialogSummaryOrNull() ?: return null
    var latestSummary: String = initialSummary
    val deadlineMillis = System.currentTimeMillis() + internalUiTimeoutMillis
    var quietPeriodStartMillis: Long? = null

    while (System.currentTimeMillis() < deadlineMillis) {
        val currentSummary: String? = currentBlockingSystemDialogSummaryOrNull()
        if (currentSummary == null) {
            val quietSinceMillis: Long = quietPeriodStartMillis ?: System.currentTimeMillis().also { timestamp ->
                quietPeriodStartMillis = timestamp
            }
            if (System.currentTimeMillis() - quietSinceMillis >= systemDialogDismissQuietPeriodMillis) {
                return latestSummary
            }
            Thread.sleep(systemDialogDismissPollMillis)
            continue
        }

        quietPeriodStartMillis = null
        latestSummary = currentSummary
        val waitButtons = findObjects(By.res(systemDialogWaitButtonResourceId))
        val closeAppButtons = findObjects(By.res(systemDialogCloseAppButtonResourceId))
        val waitButton = waitButtons.lastOrNull()
        if (waitButton == null || closeAppButtons.isEmpty()) {
            Thread.sleep(systemDialogDismissPollMillis)
            continue
        }

        waitButton.click()
        waitForIdle()
        wait(Until.gone(By.res(systemDialogWaitButtonResourceId)), systemDialogDismissPollMillis)
        wait(Until.gone(By.res(systemDialogCloseAppButtonResourceId)), systemDialogDismissPollMillis)
        Thread.sleep(systemDialogDismissPollMillis)
    }

    return latestSummary
}

internal fun UiDevice.currentBlockingSystemDialogSummaryOrNull(): String? {
    val dialogTitle: String? = findObjects(By.res(systemDialogAlertTitleResourceId))
        .mapNotNull { titleNode -> titleNode.text?.trim() }
        .firstOrNull { title -> title.contains("isn't responding") }
    val dialogMessage: String? = findObject(By.textContains("isn't responding"))?.text
    val waitButtonVisible: Boolean = findObjects(By.res(systemDialogWaitButtonResourceId)).isNotEmpty()
    val closeAppButtonVisible: Boolean = findObjects(By.res(systemDialogCloseAppButtonResourceId)).isNotEmpty()
    if (waitButtonVisible.not() || closeAppButtonVisible.not()) {
        return null
    }
    return listOfNotNull(dialogTitle, dialogMessage).joinToString(separator = " | ").ifBlank {
        "external_system_dialog"
    }
}

internal fun LiveSmokeContext.dismissExternalSystemDialogIfPresent(): String? {
    return device.dismissBlockingSystemDialogIfPresent()
}

internal fun LiveSmokeContext.currentBlockingSystemDialogSummaryOrNull(): String? {
    return device.currentBlockingSystemDialogSummaryOrNull()
}

private fun runShellCommand(command: String): String {
    val shellOutput = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command)
    ParcelFileDescriptor.AutoCloseInputStream(shellOutput).use { inputStream ->
        BufferedReader(InputStreamReader(inputStream)).use { reader ->
            return reader.readText()
        }
    }
}

internal fun LiveSmokeContext.appGraph() =
    (composeRule.activity.application as FlashcardsApplication).appGraph

internal fun LiveSmokeContext.scrollToText(text: String) {
    composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(hasText(text))
}
