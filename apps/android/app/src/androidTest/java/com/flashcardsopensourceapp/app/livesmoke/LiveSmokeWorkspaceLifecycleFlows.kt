@file:OptIn(androidx.compose.ui.test.ExperimentalTestApi::class)

package com.flashcardsopensourceapp.app.livesmoke

import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextReplacement
import com.flashcardsopensourceapp.app.FlashcardsApplication
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.feature.settings.workspace.currentWorkspaceCreateButtonTag
import com.flashcardsopensourceapp.feature.settings.workspace.currentWorkspaceExistingRowTag
import com.flashcardsopensourceapp.feature.settings.workspace.currentWorkspaceListTag
import com.flashcardsopensourceapp.feature.settings.workspace.workspaceOverviewDeleteConfirmationButtonTag
import com.flashcardsopensourceapp.feature.settings.workspace.workspaceOverviewDeleteConfirmationDialogTag
import com.flashcardsopensourceapp.feature.settings.workspace.workspaceOverviewDeleteConfirmationErrorTag
import com.flashcardsopensourceapp.feature.settings.workspace.workspaceOverviewDeleteConfirmationFieldTag
import com.flashcardsopensourceapp.feature.settings.workspace.workspaceOverviewDeleteConfirmationLoadingTag
import com.flashcardsopensourceapp.feature.settings.workspace.workspaceOverviewDeleteConfirmationPhraseTag
import com.flashcardsopensourceapp.feature.settings.workspace.workspaceOverviewDeletePreviewBodyTag
import com.flashcardsopensourceapp.feature.settings.workspace.workspaceOverviewDeletePreviewContinueButtonTag
import com.flashcardsopensourceapp.feature.settings.workspace.workspaceOverviewDeletePreviewDialogTag
import com.flashcardsopensourceapp.feature.settings.workspace.workspaceOverviewDeleteWorkspaceButtonTag
import com.flashcardsopensourceapp.feature.settings.workspace.workspaceOverviewNameFieldTag
import com.flashcardsopensourceapp.feature.settings.workspace.workspaceOverviewSaveNameButtonTag
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

private enum class DeletePreviewResolution {
    PREVIEW_READY,
    ERROR_VISIBLE
}

private data class LinkedWorkspaceSelectionSnapshot(
    val cloudState: CloudAccountState,
    val activeWorkspaceId: String?,
    val linkedWorkspaceId: String?,
    val workspaceId: String?,
    val workspaceName: String?
)

internal data class EphemeralWorkspaceHandle(
    val workspaceId: String,
    val workspaceName: String
)

internal fun LiveSmokeContext.createEphemeralWorkspace(workspaceName: String): EphemeralWorkspaceHandle {
    openSettingsTab()
    clickText(text = "Current Workspace", substring = false)
    waitForCurrentWorkspaceScreenToSettle()
    waitUntilAtLeastOneExistsOrFail(
        matcher = hasText("Create new workspace"),
        timeoutMillis = internalUiTimeoutMillis
    )
    waitForSelectedWorkspaceSummary(
        context = "before creating a linked workspace",
        timeoutMillis = internalUiTimeoutMillis
    )
    val selectedWorkspaceSummaryBeforeCreate: String = selectedWorkspaceSummary(
        context = "before creating a linked workspace"
    )
    val selectedWorkspaceIdBeforeCreate: String = currentWorkspaceIdOrThrow(
        context = "before creating a linked workspace"
    )
    composeRule.onNodeWithTag(currentWorkspaceListTag).performScrollToNode(
        matcher = hasTestTag(currentWorkspaceCreateButtonTag)
    )
    clickTag(tag = currentWorkspaceCreateButtonTag, label = "Create new workspace")
    val createdWorkspaceSelection: LinkedWorkspaceSelectionSnapshot = waitForLinkedWorkspaceSelectionToChange(
        previousWorkspaceId = selectedWorkspaceIdBeforeCreate,
        timeoutMillis = externalUiTimeoutMillis,
        context = "after creating a linked workspace"
    )
    waitForSelectedWorkspaceSummaryToChange(
        beforeSummary = selectedWorkspaceSummaryBeforeCreate,
        context = "after creating a linked workspace",
        timeoutMillis = externalUiTimeoutMillis
    )
    waitForCurrentWorkspaceOperationToFinish()
    tapBackIcon()

    openSettingsSection(sectionTitle = "Workspace")
    clickText(text = "Overview", substring = false)
    waitForWorkspaceOverviewReady(
        expectedWorkspaceName = workspaceName,
        requireExpectedWorkspaceName = false,
        context = "before renaming the linked workspace"
    )
    composeRule.onNodeWithTag(workspaceOverviewNameFieldTag).performTextReplacement(workspaceName)
    clickTag(tag = workspaceOverviewSaveNameButtonTag, label = "Save workspace name")
    waitForWorkspaceRenameOutcome(expectedWorkspaceName = workspaceName)
    val renamedWorkspaceSelection: LinkedWorkspaceSelectionSnapshot = waitForLinkedWorkspaceName(
        expectedWorkspaceName = workspaceName,
        timeoutMillis = externalUiTimeoutMillis,
        context = "after renaming the linked workspace"
    )
    tapBackIcon()
    tapBackIcon()
    openSettingsTab()
    clickText(text = "Current Workspace", substring = false)
    waitForCurrentWorkspaceScreenToSettle()
    waitForCurrentWorkspaceName(expectedWorkspaceName = workspaceName)
    tapBackIcon()

    return EphemeralWorkspaceHandle(
        workspaceId = renamedWorkspaceSelection.workspaceId ?: createdWorkspaceSelection.workspaceId
            ?: throw AssertionError(
                "Created linked workspace did not expose a stable workspace ID. " +
                    "CloudSettings=${currentCloudSettingsSummary()} " +
                    "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}"
            ),
        workspaceName = workspaceName
    )
}

internal fun LiveSmokeContext.deleteEphemeralWorkspace(workspaceHandle: EphemeralWorkspaceHandle) {
    forceLinkedSyncAndWaitForWorkspace(
        workspaceHandle = workspaceHandle,
        timeoutMillis = externalUiTimeoutMillis
    )
    openSettingsTab()
    clickText(text = "Current Workspace", substring = false)
    waitForCurrentWorkspaceScreenToSettle()
    waitUntilAtLeastOneExistsOrFail(
        matcher = hasText("Create new workspace"),
        timeoutMillis = internalUiTimeoutMillis
    )
    if (composeRule.onAllNodesWithText(workspaceHandle.workspaceName).fetchSemanticsNodes().isEmpty()) {
        tapBackIcon()
        return
    }
    waitForSelectedWorkspaceSummary(
        context = "before deleting the isolated linked workspace",
        timeoutMillis = internalUiTimeoutMillis
    )
    tapBackIcon()

    openSettingsSection(sectionTitle = "Workspace")
    clickText(text = "Overview", substring = false)
    waitForWorkspaceOverviewReady(
        expectedWorkspaceName = workspaceHandle.workspaceName,
        requireExpectedWorkspaceName = true,
        context = "before deleting the isolated linked workspace"
    )
    openDeletePreview(workspaceName = workspaceHandle.workspaceName)
    clickTag(
        tag = workspaceOverviewDeletePreviewContinueButtonTag,
        label = "Continue workspace delete preview"
    )
    waitForDeleteConfirmationReady(workspaceName = workspaceHandle.workspaceName)
    val confirmationPhrase: String = requireNotNull(deleteConfirmationPhraseOrNull()) {
        "Delete confirmation phrase was missing for workspace '${workspaceHandle.workspaceName}'."
    }
    composeRule.onNodeWithTag(workspaceOverviewDeleteConfirmationFieldTag)
        .performTextReplacement(confirmationPhrase)
    tapDeleteWorkspaceConfirmation(workspaceName = workspaceHandle.workspaceName)
    waitForLinkedWorkspaceSelectionToChange(
        previousWorkspaceId = workspaceHandle.workspaceId,
        timeoutMillis = externalUiTimeoutMillis,
        context = "after deleting the isolated linked workspace"
    )
    tapBackIcon()
    openSettingsTab()
    clickText(text = "Current Workspace", substring = false)
    waitForCurrentWorkspaceScreenToSettle()
    try {
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for workspace deletion to finish"
        ) {
            val currentWorkspaceName: String? = currentWorkspaceNameOrNull()
            val selectedSummary: String? = selectedWorkspaceSummaryOrNull()
            composeRule.onAllNodesWithText(workspaceHandle.workspaceName).fetchSemanticsNodes().isEmpty() &&
                currentWorkspaceName != workspaceHandle.workspaceName &&
                selectedSummary?.contains(other = workspaceHandle.workspaceName) != true
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Workspace deletion did not switch away from '${workspaceHandle.workspaceName}'. " +
                "CurrentWorkspace=${currentWorkspaceSummaryOrNull()} " +
                "CloudSettings=${currentCloudSettingsSummary()} " +
                "VisibleRows=${captureVisibleWorkspaceRows(rowTag = currentWorkspaceExistingRowTag)} " +
                "WorkspaceOverviewError=${workspaceOverviewErrorMessageOrNull()} " +
                "PreviewDialogVisible=${isDeletePreviewDialogVisible()} " +
                "ConfirmationDialogVisible=${isDeleteConfirmationDialogVisible()}",
            error
        )
    }
    waitForSelectedWorkspaceSummary(
        context = "after deleting the isolated linked workspace",
        timeoutMillis = externalUiTimeoutMillis
    )
    tapBackIcon()
}

internal fun LiveSmokeContext.forceLinkedSyncAndWaitForWorkspace(
    workspaceHandle: EphemeralWorkspaceHandle,
    timeoutMillis: Long
) {
    waitForLinkedWorkspaceHandle(
        workspaceHandle = workspaceHandle,
        timeoutMillis = timeoutMillis,
        context = "before forcing linked sync before cleanup"
    )
    val appGraph = (composeRule.activity.application as FlashcardsApplication).appGraph
    try {
        runBlocking {
            appGraph.syncRepository.syncNow()
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Forced linked sync before cleanup failed. " +
                "WorkspaceId=${workspaceHandle.workspaceId} " +
                "WorkspaceName=${workspaceHandle.workspaceName} " +
                "CloudSettings=${currentCloudSettingsSummary()} " +
                "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}",
            error
        )
    }
    waitForLinkedWorkspaceHandle(
        workspaceHandle = workspaceHandle,
        timeoutMillis = timeoutMillis,
        context = "after forcing linked sync before cleanup"
    )

    openSettingsTab()
    clickText(text = "Current Workspace", substring = false)
    waitForCurrentWorkspaceScreenToSettle()
    waitForCurrentWorkspaceName(expectedWorkspaceName = workspaceHandle.workspaceName)
    waitForSelectedWorkspaceSummary(
        context = "after forcing linked sync before cleanup",
        timeoutMillis = timeoutMillis
    )
    val selectedWorkspace: String = selectedWorkspaceSummary(
        context = "after forcing linked sync before cleanup"
    )
    if (selectedWorkspace.contains(other = workspaceHandle.workspaceName).not()) {
        throw AssertionError(
            "Forced linked sync kept the wrong workspace selected before cleanup. " +
                "ExpectedWorkspaceId=${workspaceHandle.workspaceId} " +
                "ExpectedWorkspaceName=${workspaceHandle.workspaceName} " +
                "SelectedWorkspace=$selectedWorkspace " +
                "CloudSettings=${currentCloudSettingsSummary()} " +
                "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}"
        )
    }
    tapBackIcon()
}

private fun LiveSmokeContext.openDeletePreview(workspaceName: String) {
    clickTag(tag = workspaceOverviewDeleteWorkspaceButtonTag, label = "Delete workspace")
    val resolution: DeletePreviewResolution = waitForDeletePreviewResolution(workspaceName = workspaceName)
    if (resolution == DeletePreviewResolution.PREVIEW_READY) {
        return
    }
    throw AssertionError(
        "Delete workspace preview resolved with an error state. " +
            "Workspace=$workspaceName " +
            "WorkspaceOverviewError=${workspaceOverviewErrorMessageOrNull()} " +
            "PreviewBody=${deletePreviewBodyTextOrNull()} " +
            "VisibleRows=${captureVisibleWorkspaceRows(rowTag = currentWorkspaceExistingRowTag)} " +
            "CloudSettings=${currentCloudSettingsSummary()} " +
            "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}"
    )
}

private fun LiveSmokeContext.waitForDeletePreviewResolution(
    workspaceName: String
): DeletePreviewResolution {
    try {
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for delete preview resolution for '$workspaceName'"
        ) {
            isDeletePreviewDialogVisible() || workspaceOverviewErrorMessageOrNull() != null
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Delete workspace preview did not resolve for '$workspaceName'. " +
                "WorkspaceOverviewError=${workspaceOverviewErrorMessageOrNull()} " +
                "PreviewBody=${deletePreviewBodyTextOrNull()} " +
                "VisibleRows=${captureVisibleWorkspaceRows(rowTag = currentWorkspaceExistingRowTag)} " +
                "CloudSettings=${currentCloudSettingsSummary()} " +
                "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}",
            error
        )
    }
    return if (isDeletePreviewDialogVisible()) {
        DeletePreviewResolution.PREVIEW_READY
    } else {
        DeletePreviewResolution.ERROR_VISIBLE
    }
}

private fun LiveSmokeContext.waitForDeleteConfirmationReady(workspaceName: String) {
    try {
        waitForTagToExist(
            tag = workspaceOverviewDeleteConfirmationDialogTag,
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for the delete confirmation dialog for '$workspaceName'"
        )
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for delete confirmation readiness for '$workspaceName'"
        ) {
            isDeleteConfirmationDialogVisible() &&
                deleteConfirmationPhraseOrNull().isNullOrBlank().not() &&
                composeRule.onAllNodesWithTag(workspaceOverviewDeleteConfirmationFieldTag)
                    .fetchSemanticsNodes()
                    .isNotEmpty()
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Delete confirmation dialog did not become ready for '$workspaceName'. " +
                "ConfirmationPhrase=${deleteConfirmationPhraseOrNull()} " +
                "ConfirmationError=${deleteConfirmationErrorOrNull()} " +
                "ConfirmationLoading=${isDeleteConfirmationLoadingVisible()} " +
                "WorkspaceOverviewError=${workspaceOverviewErrorMessageOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.tapDeleteWorkspaceConfirmation(workspaceName: String) {
    dismissExternalSystemDialogIfPresent()
    composeRule.onNodeWithTag(workspaceOverviewDeleteConfirmationButtonTag).performClick()
    composeRule.waitForIdle()
    try {
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for delete confirmation completion for '$workspaceName'"
        ) {
            val confirmationError: String? = deleteConfirmationErrorOrNull()
            if (confirmationError != null) {
                throw AssertionError(
                    "Delete workspace confirmation failed for '$workspaceName': $confirmationError. " +
                        "ConfirmationPhrase=${deleteConfirmationPhraseOrNull()} " +
                        "CloudSettings=${currentCloudSettingsSummary()} " +
                        "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}"
                )
            }
            isDeleteConfirmationDialogVisible().not()
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Delete workspace confirmation did not complete for '$workspaceName'. " +
                "ConfirmationError=${deleteConfirmationErrorOrNull()} " +
                "ConfirmationLoading=${isDeleteConfirmationLoadingVisible()} " +
                "ConfirmationPhrase=${deleteConfirmationPhraseOrNull()} " +
                "WorkspaceOverviewError=${workspaceOverviewErrorMessageOrNull()} " +
                "CloudSettings=${currentCloudSettingsSummary()} " +
                "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.waitForCurrentWorkspaceOperationToFinish() {
    waitForCurrentWorkspaceOperationToLeaveSwitchingState()
    try {
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for current workspace operation to finish"
        ) {
            currentWorkspaceOperationMessageOrNull() == null &&
                currentWorkspaceNameOrNull() != "Unavailable" &&
                selectedWorkspaceSummaryOrNull() != null
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Current workspace operation did not finish. " +
                "Operation=${currentWorkspaceOperationMessageOrNull()} " +
                "SelectedRow=${selectedWorkspaceSummaryOrNull()} " +
                "Current workspace name=${currentWorkspaceNameOrNull()} " +
                "Error=${currentWorkspaceErrorMessageOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.waitForCurrentWorkspaceOperationToLeaveSwitchingState() {
    try {
        waitUntilWithMitigation(
            timeoutMillis = internalUiTimeoutMillis,
            context = "while waiting for current workspace operation to leave switching"
        ) {
            currentWorkspaceOperationMessageOrNull()
                ?.startsWith(prefix = "Switching to")
                ?.not()
                ?: true
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Current workspace operation stayed in SWITCHING without progressing. " +
                "Operation=${currentWorkspaceOperationMessageOrNull()} " +
                "SelectedRow=${selectedWorkspaceSummaryOrNull()} " +
                "Current workspace name=${currentWorkspaceNameOrNull()} " +
                "Error=${currentWorkspaceErrorMessageOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.waitForWorkspaceRenameOutcome(expectedWorkspaceName: String) {
    try {
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for workspace rename to persist"
        ) {
            workspaceOverviewNameFieldValueOrNull() == expectedWorkspaceName &&
                hasVisibleText(text = "Saving...", substring = false).not()
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Workspace rename did not persist on the Overview screen. " +
                "FieldValue=${workspaceOverviewNameFieldValueOrNull()} " +
                "Error=${workspaceOverviewErrorMessageOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.waitForWorkspaceOverviewReady(
    expectedWorkspaceName: String,
    requireExpectedWorkspaceName: Boolean,
    context: String
) {
    try {
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for workspace overview readiness $context"
        ) {
            val workspaceNameFieldValue: String? = workspaceOverviewNameFieldValueOrNull()
            workspaceOverviewErrorMessageOrNull() == null &&
                hasVisibleText(text = "Saving...", substring = false).not() &&
                workspaceNameFieldValue != null &&
                workspaceNameFieldValue != "Unavailable" &&
                (
                    requireExpectedWorkspaceName.not() ||
                        workspaceNameFieldValue == expectedWorkspaceName
                    )
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Workspace overview did not settle $context. " +
                "ExpectedWorkspaceName=$expectedWorkspaceName " +
                "FieldValue=${workspaceOverviewNameFieldValueOrNull()} " +
                "Error=${workspaceOverviewErrorMessageOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.currentWorkspaceIdOrThrow(context: String): String {
    return runBlocking {
        requireNotNull(appGraph().workspaceRepository.observeWorkspace().first()?.workspaceId) {
            "Workspace ID was missing $context."
        }
    }
}

private fun LiveSmokeContext.waitForLinkedWorkspaceSelection(
    timeoutMillis: Long,
    context: String,
    predicate: (LinkedWorkspaceSelectionSnapshot) -> Boolean
): LinkedWorkspaceSelectionSnapshot {
    val appGraph = appGraph()
    try {
        return waitForFlowValue(
            timeoutMillis = timeoutMillis,
            context = "while waiting for linked workspace selection $context",
            flow = combine(
                appGraph.cloudAccountRepository.observeCloudSettings(),
                appGraph.workspaceRepository.observeWorkspace()
            ) { cloudSettings, workspace ->
                LinkedWorkspaceSelectionSnapshot(
                    cloudState = cloudSettings.cloudState,
                    activeWorkspaceId = cloudSettings.activeWorkspaceId,
                    linkedWorkspaceId = cloudSettings.linkedWorkspaceId,
                    workspaceId = workspace?.workspaceId,
                    workspaceName = workspace?.name
                )
            },
            predicate = predicate
        )
    } catch (error: Throwable) {
        throw AssertionError(
            "Linked workspace selection did not settle $context. " +
                "Snapshot=${currentLinkedWorkspaceSelectionSnapshotSummary()} " +
                "CloudSettings=${currentCloudSettingsSummary()} " +
                "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.waitForLinkedWorkspaceSelectionToChange(
    previousWorkspaceId: String,
    timeoutMillis: Long,
    context: String
): LinkedWorkspaceSelectionSnapshot {
    return waitForLinkedWorkspaceSelection(
        timeoutMillis = timeoutMillis,
        context = context
    ) { snapshot ->
        snapshot.isStableLinkedSelection() &&
            snapshot.workspaceId != previousWorkspaceId
    }
}

private fun LiveSmokeContext.waitForLinkedWorkspaceName(
    expectedWorkspaceName: String,
    timeoutMillis: Long,
    context: String
): LinkedWorkspaceSelectionSnapshot {
    return waitForLinkedWorkspaceSelection(
        timeoutMillis = timeoutMillis,
        context = context
    ) { snapshot ->
        snapshot.isStableLinkedSelection() &&
            snapshot.workspaceName == expectedWorkspaceName
    }
}

private fun LiveSmokeContext.waitForLinkedWorkspaceHandle(
    workspaceHandle: EphemeralWorkspaceHandle,
    timeoutMillis: Long,
    context: String
): LinkedWorkspaceSelectionSnapshot {
    return waitForLinkedWorkspaceSelection(
        timeoutMillis = timeoutMillis,
        context = context
    ) { snapshot ->
        snapshot.isStableLinkedSelection() &&
            snapshot.workspaceId == workspaceHandle.workspaceId &&
            snapshot.workspaceName == workspaceHandle.workspaceName
    }
}

private fun LinkedWorkspaceSelectionSnapshot.isStableLinkedSelection(): Boolean {
    return cloudState == CloudAccountState.LINKED &&
        activeWorkspaceId != null &&
        activeWorkspaceId == linkedWorkspaceId &&
        activeWorkspaceId == workspaceId
}

private fun LiveSmokeContext.currentLinkedWorkspaceSelectionSnapshotSummary(): String {
    val snapshot = runBlocking {
        combine(
            appGraph().cloudAccountRepository.observeCloudSettings(),
            appGraph().workspaceRepository.observeWorkspace()
        ) { cloudSettings, workspace ->
            LinkedWorkspaceSelectionSnapshot(
                cloudState = cloudSettings.cloudState,
                activeWorkspaceId = cloudSettings.activeWorkspaceId,
                linkedWorkspaceId = cloudSettings.linkedWorkspaceId,
                workspaceId = workspace?.workspaceId,
                workspaceName = workspace?.name
            )
        }.first()
    }
    return "cloudState=${snapshot.cloudState} " +
        "activeWorkspaceId=${snapshot.activeWorkspaceId} " +
        "linkedWorkspaceId=${snapshot.linkedWorkspaceId} " +
        "workspaceId=${snapshot.workspaceId} " +
        "workspaceName=${snapshot.workspaceName}"
}

private fun LiveSmokeContext.isDeletePreviewDialogVisible(): Boolean {
    return composeRule.onAllNodesWithTag(workspaceOverviewDeletePreviewDialogTag)
        .fetchSemanticsNodes()
        .isNotEmpty()
}

private fun LiveSmokeContext.deletePreviewBodyTextOrNull(): String? {
    return composeRule.onAllNodesWithTag(workspaceOverviewDeletePreviewBodyTag)
        .fetchSemanticsNodes()
        .singleOrNull()
        ?.let(::nodeSummary)
}

private fun LiveSmokeContext.isDeleteConfirmationDialogVisible(): Boolean {
    return composeRule.onAllNodesWithTag(workspaceOverviewDeleteConfirmationDialogTag)
        .fetchSemanticsNodes()
        .isNotEmpty()
}

private fun LiveSmokeContext.deleteConfirmationPhraseOrNull(): String? {
    return composeRule.onAllNodesWithTag(workspaceOverviewDeleteConfirmationPhraseTag)
        .fetchSemanticsNodes()
        .singleOrNull()
        ?.let(::nodeSummary)
}

private fun LiveSmokeContext.deleteConfirmationErrorOrNull(): String? {
    return composeRule.onAllNodesWithTag(workspaceOverviewDeleteConfirmationErrorTag)
        .fetchSemanticsNodes()
        .singleOrNull()
        ?.let(::nodeSummary)
}

private fun LiveSmokeContext.isDeleteConfirmationLoadingVisible(): Boolean {
    return composeRule.onAllNodesWithTag(workspaceOverviewDeleteConfirmationLoadingTag)
        .fetchSemanticsNodes()
        .isNotEmpty()
}
