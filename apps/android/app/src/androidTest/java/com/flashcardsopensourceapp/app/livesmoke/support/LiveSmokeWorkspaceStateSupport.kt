@file:OptIn(androidx.compose.ui.test.ExperimentalTestApi::class)

package com.flashcardsopensourceapp.app.livesmoke.support

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.nodeSummary
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.nodeSummaryIncludingDescendants
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.waitUntilWithMitigation
import com.flashcardsopensourceapp.feature.settings.workspace.current.currentWorkspaceChangeActionTag
import com.flashcardsopensourceapp.feature.settings.workspace.current.currentWorkspaceChangeSheetListTag
import com.flashcardsopensourceapp.feature.settings.workspace.current.currentWorkspaceChangeSheetTag
import com.flashcardsopensourceapp.feature.settings.workspace.current.currentWorkspaceErrorMessageTag
import com.flashcardsopensourceapp.feature.settings.workspace.current.currentWorkspaceExistingRowTag
import com.flashcardsopensourceapp.feature.settings.workspace.current.currentWorkspaceListTag
import com.flashcardsopensourceapp.feature.settings.workspace.current.currentWorkspaceLoadingStateTag
import com.flashcardsopensourceapp.feature.settings.workspace.current.currentWorkspaceNameTag
import com.flashcardsopensourceapp.feature.settings.workspace.current.currentWorkspaceOperationMessageTag
import com.flashcardsopensourceapp.feature.settings.workspace.current.currentWorkspaceRenameActionTag
import com.flashcardsopensourceapp.feature.settings.workspace.current.currentWorkspaceSelectedSummaryTag
import com.flashcardsopensourceapp.feature.settings.workspace.delete.workspaceOverviewErrorMessageTag
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

internal fun LiveSmokeContext.waitForSelectedWorkspaceSummary(context: String, timeoutMillis: Long) {
    try {
        scrollCurrentWorkspaceListToSelectedWorkspace()
        waitUntilWithMitigation(
            timeoutMillis = timeoutMillis,
            context = "while waiting for current workspace selection $context"
        ) {
            selectedWorkspaceSummaryOrNull() != null
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Workspace selection did not settle $context. " +
                "Visible linked workspaces=${captureVisibleWorkspaceRows(rowTag = currentWorkspaceExistingRowTag)} " +
                "WorkspaceName=${currentWorkspaceNameOrNull()}",
            error
        )
    }
}

internal fun LiveSmokeContext.openCurrentWorkspaceChangeSheet(timeoutMillis: Long) {
    if (
        composeRule.onAllNodesWithTag(currentWorkspaceChangeSheetTag)
            .fetchSemanticsNodes()
            .isNotEmpty()
    ) {
        return
    }
    composeRule.onNodeWithTag(currentWorkspaceListTag).performScrollToNode(
        matcher = hasTestTag(currentWorkspaceChangeActionTag)
    )
    composeRule.onNodeWithTag(currentWorkspaceChangeActionTag).performClick()
    waitUntilWithMitigation(
        timeoutMillis = timeoutMillis,
        context = "while opening the Change workspace sheet"
    ) {
        composeRule.onAllNodesWithTag(currentWorkspaceChangeSheetTag)
            .fetchSemanticsNodes()
            .isNotEmpty()
    }
}

internal fun LiveSmokeContext.dismissCurrentWorkspaceChangeSheet(timeoutMillis: Long) {
    if (
        composeRule.onAllNodesWithTag(currentWorkspaceChangeSheetTag)
            .fetchSemanticsNodes()
            .isEmpty()
    ) {
        return
    }
    device.pressBack()
    waitUntilWithMitigation(
        timeoutMillis = timeoutMillis,
        context = "while dismissing the Change workspace sheet"
    ) {
        composeRule.onAllNodesWithTag(currentWorkspaceChangeSheetTag)
            .fetchSemanticsNodes()
            .isEmpty()
    }
}

internal fun LiveSmokeContext.waitForCurrentWorkspaceChangeSheetToSettle(timeoutMillis: Long) {
    openCurrentWorkspaceChangeSheet(timeoutMillis = timeoutMillis)
    try {
        waitUntilWithMitigation(
            timeoutMillis = timeoutMillis,
            context = "while waiting for the Change workspace sheet to settle"
        ) {
            val visibleError: String? = currentWorkspaceVisibleErrorMessageOrNull()
            if (visibleError != null) {
                throw AssertionError("Change workspace settled with an error: $visibleError")
            }

            val isLoading: Boolean = composeRule.onAllNodesWithTag(currentWorkspaceLoadingStateTag)
                .fetchSemanticsNodes()
                .isNotEmpty()
            isLoading.not() && composeRule.onAllNodesWithTag(currentWorkspaceChangeSheetListTag)
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Change workspace sheet did not settle. " +
                "Loading=${composeRule.onAllNodesWithTag(currentWorkspaceLoadingStateTag).fetchSemanticsNodes().isNotEmpty()} " +
                "Error=${currentWorkspaceVisibleErrorMessageOrNull()} " +
                "VisibleRows=${captureVisibleWorkspaceRows(rowTag = currentWorkspaceExistingRowTag)}",
            error
        )
    }
}

internal fun LiveSmokeContext.waitForCurrentWorkspaceScreenToSettle(timeoutMillis: Long) {
    try {
        waitUntilWithMitigation(
            timeoutMillis = timeoutMillis,
            context = "while waiting for the Workspace screen to settle"
        ) {
            val visibleError: String? = currentWorkspaceVisibleErrorMessageOrNull()
            if (visibleError != null) {
                throw AssertionError("Workspace settled with an error: $visibleError")
            }

            val changeAction = composeRule.onAllNodesWithTag(currentWorkspaceChangeActionTag)
                .fetchSemanticsNodes()
                .singleOrNull()
            val renameAction = composeRule.onAllNodesWithTag(currentWorkspaceRenameActionTag)
                .fetchSemanticsNodes()
                .singleOrNull()
            currentWorkspaceNameOrNull() != null &&
                changeAction != null &&
                changeAction.config.contains(SemanticsProperties.Disabled).not() &&
                renameAction != null &&
                renameAction.config.contains(SemanticsProperties.Disabled).not()
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Workspace screen did not settle. " +
                "ChangeAction=${composeRule.onAllNodesWithTag(currentWorkspaceChangeActionTag).fetchSemanticsNodes().isNotEmpty()} " +
                "Error=${currentWorkspaceVisibleErrorMessageOrNull()} " +
                "WorkspaceName=${currentWorkspaceNameOrNull()}",
            error
        )
    }
}

internal fun LiveSmokeContext.waitForCurrentWorkspaceName(expectedWorkspaceName: String) {
    try {
        waitUntilWithMitigation(
            timeoutMillis = internalUiTimeoutMillis,
            context = "while waiting for Workspace top card to update"
        ) {
            currentWorkspaceNameOrNull() == expectedWorkspaceName
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Workspace top card did not update after rename. " +
                "TopCard=${currentWorkspaceNameOrNull()} " +
                "SelectedRow=${selectedWorkspaceSummaryOrNull()}",
            error
        )
    }
}

internal fun LiveSmokeContext.selectedWorkspaceSummary(context: String): String {
    val selectedSummary: String? = selectedWorkspaceSummaryOrNull()
    return requireNotNull(selectedSummary) {
        "Workspace selection was missing $context."
    }
}

internal fun LiveSmokeContext.selectedWorkspaceSummaryOrNull(): String? {
    val taggedSelection: String? = selectedWorkspaceSummaryFromCurrentSemanticsTree()
    if (taggedSelection != null) {
        return taggedSelection
    }
    scrollCurrentWorkspaceListToSelectedWorkspace()
    return selectedWorkspaceSummaryFromCurrentSemanticsTree()
}

private fun LiveSmokeContext.selectedWorkspaceSummaryFromCurrentSemanticsTree(): String? {
    return selectedWorkspaceSummaryFromSemanticsTree(useUnmergedTree = false)
        ?: selectedWorkspaceSummaryFromSemanticsTree(useUnmergedTree = true)
}

private fun LiveSmokeContext.selectedWorkspaceSummaryFromSemanticsTree(
    useUnmergedTree: Boolean
): String? {
    return composeRule.onAllNodesWithTag(
        testTag = currentWorkspaceSelectedSummaryTag,
        useUnmergedTree = useUnmergedTree
    )
        .fetchSemanticsNodes()
        .singleOrNull()
        ?.let(::nodeSummaryIncludingDescendants)
        ?.trim()
        ?.takeIf { summary -> summary.isNotBlank() }
}

internal fun LiveSmokeContext.deleteCurrentWorkspaceErrorMessageOrNull(): String? {
    return composeRule.onAllNodesWithTag(workspaceOverviewErrorMessageTag)
        .fetchSemanticsNodes()
        .singleOrNull()
        ?.let(::nodeSummary)
}

internal fun LiveSmokeContext.currentWorkspaceNameOrNull(): String? {
    scrollCurrentWorkspaceListToTopCard()
    return composeRule.onAllNodesWithTag(currentWorkspaceNameTag)
        .fetchSemanticsNodes()
        .singleOrNull()
        ?.let(::nodeSummary)
}

internal fun LiveSmokeContext.currentWorkspaceErrorMessageOrNull(): String? {
    scrollCurrentWorkspaceListToTopCard()
    return currentWorkspaceVisibleErrorMessageOrNull()
}

internal fun LiveSmokeContext.currentWorkspaceVisibleErrorMessageOrNull(): String? {
    return composeRule.onAllNodesWithTag(currentWorkspaceErrorMessageTag)
        .fetchSemanticsNodes()
        .singleOrNull()
        ?.let(::nodeSummary)
}

internal fun LiveSmokeContext.currentWorkspaceOperationMessageOrNull(): String? {
    scrollCurrentWorkspaceListToTopCard()
    return composeRule.onAllNodesWithTag(currentWorkspaceOperationMessageTag)
        .fetchSemanticsNodes()
        .singleOrNull()
        ?.let(::nodeSummary)
}

private fun LiveSmokeContext.scrollCurrentWorkspaceListToSelectedWorkspace() {
    if (composeRule.onAllNodesWithTag(currentWorkspaceChangeSheetListTag).fetchSemanticsNodes().isEmpty()) {
        return
    }
    runCatching {
        composeRule.onNodeWithTag(currentWorkspaceChangeSheetListTag).performScrollToNode(
            matcher = hasTestTag(currentWorkspaceSelectedSummaryTag)
        )
    }
}

private fun LiveSmokeContext.scrollCurrentWorkspaceListToTopCard() {
    if (
        composeRule.onAllNodesWithTag(currentWorkspaceChangeSheetTag)
            .fetchSemanticsNodes()
            .isNotEmpty()
    ) {
        return
    }
    if (composeRule.onAllNodesWithTag(currentWorkspaceListTag).fetchSemanticsNodes().isEmpty()) {
        return
    }
    composeRule.onNodeWithTag(currentWorkspaceListTag).performScrollToNode(
        matcher = hasTestTag(currentWorkspaceNameTag)
    )
}

internal fun LiveSmokeContext.captureVisibleWorkspaceRows(rowTag: String): List<String> {
    return composeRule.onAllNodesWithTag(rowTag)
        .fetchSemanticsNodes()
        .map(::nodeSummaryIncludingDescendants)
}

internal fun LiveSmokeContext.currentCloudSettingsSummary(): String {
    return runBlocking {
        val appGraph: AppGraph = appGraph()
        val cloudSettings = appGraph.cloudAccountRepository.observeCloudSettings().first()
        "cloudState=${cloudSettings.cloudState} " +
            "linkedUserId=${cloudSettings.linkedUserId} " +
            "linkedWorkspaceId=${cloudSettings.linkedWorkspaceId} " +
            "activeWorkspaceId=${cloudSettings.activeWorkspaceId} " +
            "installationId=${cloudSettings.installationId}"
    }
}

internal fun LiveSmokeContext.currentWorkspaceSummaryOrNull(): String? {
    return runBlocking {
        val appGraph: AppGraph = appGraph()
        appGraph.workspaceRepository.observeWorkspace().first()?.let { workspace ->
            "workspaceId=${workspace.workspaceId} name=${workspace.name}"
        }
    }
}
