@file:OptIn(androidx.compose.ui.test.ExperimentalTestApi::class)

package com.flashcardsopensourceapp.app.livesmoke

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performScrollToNode
import com.flashcardsopensourceapp.app.FlashcardsApplication
import com.flashcardsopensourceapp.feature.settings.workspace.currentWorkspaceCreateButtonTag
import com.flashcardsopensourceapp.feature.settings.workspace.currentWorkspaceErrorMessageTag
import com.flashcardsopensourceapp.feature.settings.workspace.currentWorkspaceExistingRowTag
import com.flashcardsopensourceapp.feature.settings.workspace.currentWorkspaceListTag
import com.flashcardsopensourceapp.feature.settings.workspace.currentWorkspaceLoadingStateTag
import com.flashcardsopensourceapp.feature.settings.workspace.currentWorkspaceNameTag
import com.flashcardsopensourceapp.feature.settings.workspace.currentWorkspaceOperationMessageTag
import com.flashcardsopensourceapp.feature.settings.workspace.currentWorkspaceReloadButtonTag
import com.flashcardsopensourceapp.feature.settings.workspace.currentWorkspaceSelectedSummaryTag
import com.flashcardsopensourceapp.feature.settings.workspace.workspaceOverviewErrorMessageTag
import com.flashcardsopensourceapp.feature.settings.workspace.workspaceOverviewNameFieldTag
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
            "Current workspace selection did not settle $context. " +
                "Visible linked workspaces=${captureVisibleWorkspaceRows(rowTag = currentWorkspaceExistingRowTag)} " +
                "Current workspace name=${currentWorkspaceNameOrNull()}",
            error
        )
    }
}

internal fun LiveSmokeContext.waitForSelectedWorkspaceSummaryToChange(
    beforeSummary: String,
    context: String,
    timeoutMillis: Long
) {
    try {
        waitUntilWithMitigation(
            timeoutMillis = timeoutMillis,
            context = "while waiting for current workspace selection to change $context"
        ) {
            runCatching {
                scrollCurrentWorkspaceListToSelectedWorkspace()
                selectedWorkspaceSummary(context = context) != beforeSummary
            }.getOrDefault(false)
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Current workspace selection did not change $context. " +
                "Before=$beforeSummary After=${selectedWorkspaceSummaryOrNull()} " +
                "Current workspace name=${currentWorkspaceNameOrNull()} " +
                "Error=${currentWorkspaceErrorMessageOrNull()}",
            error
        )
    }
}

internal fun LiveSmokeContext.waitForCurrentWorkspaceScreenToSettle() {
    try {
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for the Current Workspace screen to settle"
        ) {
            val visibleError: String? = currentWorkspaceVisibleErrorMessageOrNull()
            if (visibleError != null) {
                throw AssertionError("Current Workspace settled with an error: $visibleError")
            }

            val isLoading: Boolean = composeRule.onAllNodesWithTag(currentWorkspaceLoadingStateTag)
                .fetchSemanticsNodes()
                .isNotEmpty()
            isLoading.not() && (
                composeRule.onAllNodesWithTag(currentWorkspaceCreateButtonTag)
                    .fetchSemanticsNodes()
                    .isNotEmpty() ||
                    composeRule.onAllNodesWithTag(currentWorkspaceReloadButtonTag)
                        .fetchSemanticsNodes()
                        .isNotEmpty()
                )
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Current Workspace screen did not settle. " +
                "Loading=${composeRule.onAllNodesWithTag(currentWorkspaceLoadingStateTag).fetchSemanticsNodes().isNotEmpty()} " +
                "Error=${currentWorkspaceVisibleErrorMessageOrNull()} " +
                "SelectedRow=${selectedWorkspaceSummaryOrNull()}",
            error
        )
    }
}

internal fun LiveSmokeContext.waitForCurrentWorkspaceName(expectedWorkspaceName: String) {
    try {
        waitUntilWithMitigation(
            timeoutMillis = internalUiTimeoutMillis,
            context = "while waiting for Current Workspace top card to update"
        ) {
            currentWorkspaceNameOrNull() == expectedWorkspaceName
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Current Workspace top card did not update after rename. " +
                "TopCard=${currentWorkspaceNameOrNull()} " +
                "SelectedRow=${selectedWorkspaceSummaryOrNull()}",
            error
        )
    }
}

internal fun LiveSmokeContext.selectedWorkspaceSummary(context: String): String {
    val selectedSummary: String? = selectedWorkspaceSummaryOrNull()
    return requireNotNull(selectedSummary) {
        "Current workspace selection was missing $context."
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

internal fun LiveSmokeContext.workspaceOverviewNameFieldValueOrNull(): String? {
    return composeRule.onAllNodesWithTag(workspaceOverviewNameFieldTag)
        .fetchSemanticsNodes()
        .singleOrNull()
        ?.config
        ?.getOrNull(SemanticsProperties.EditableText)
        ?.text
}

internal fun LiveSmokeContext.workspaceOverviewErrorMessageOrNull(): String? {
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
    if (composeRule.onAllNodesWithTag(currentWorkspaceListTag).fetchSemanticsNodes().isEmpty()) {
        return
    }
    runCatching {
        composeRule.onNodeWithTag(currentWorkspaceListTag).performScrollToNode(
            matcher = hasTestTag(currentWorkspaceSelectedSummaryTag)
        )
    }
}

private fun LiveSmokeContext.scrollCurrentWorkspaceListToTopCard() {
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
        .map(::nodeSummary)
}

internal fun LiveSmokeContext.currentCloudSettingsSummary(): String {
    return runBlocking {
        val appGraph = (composeRule.activity.application as FlashcardsApplication).appGraph
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
        val appGraph = (composeRule.activity.application as FlashcardsApplication).appGraph
        appGraph.workspaceRepository.observeWorkspace().first()?.let { workspace ->
            "workspaceId=${workspace.workspaceId} name=${workspace.name}"
        }
    }
}
