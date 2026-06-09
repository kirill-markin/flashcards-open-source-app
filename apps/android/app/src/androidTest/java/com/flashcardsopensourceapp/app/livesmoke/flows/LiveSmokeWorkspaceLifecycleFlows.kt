@file:OptIn(androidx.compose.ui.test.ExperimentalTestApi::class)

package com.flashcardsopensourceapp.app.livesmoke.flows

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextReplacement
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.clickTag
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.dismissExternalSystemDialogIfPresent
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.hasVisibleText
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.nodeSummary
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.tapBackIcon
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.waitForFlowValue
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.waitForTagToExist
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.waitUntilAtLeastOneExistsOrFail
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.waitUntilWithMitigation
import com.flashcardsopensourceapp.app.livesmoke.support.LiveSmokeContext
import com.flashcardsopensourceapp.app.livesmoke.support.appGraph
import com.flashcardsopensourceapp.app.livesmoke.support.captureVisibleWorkspaceRows
import com.flashcardsopensourceapp.app.livesmoke.support.currentCloudSettingsSummary
import com.flashcardsopensourceapp.app.livesmoke.support.currentWorkspaceErrorMessageOrNull
import com.flashcardsopensourceapp.app.livesmoke.support.currentWorkspaceNameOrNull
import com.flashcardsopensourceapp.app.livesmoke.support.currentWorkspaceOperationMessageOrNull
import com.flashcardsopensourceapp.app.livesmoke.support.currentWorkspaceSummaryOrNull
import com.flashcardsopensourceapp.app.livesmoke.support.externalUiTimeoutMillis
import com.flashcardsopensourceapp.app.livesmoke.support.internalUiTimeoutMillis
import com.flashcardsopensourceapp.app.livesmoke.support.selectedWorkspaceSummary
import com.flashcardsopensourceapp.app.livesmoke.support.selectedWorkspaceSummaryOrNull
import com.flashcardsopensourceapp.app.livesmoke.support.waitForCurrentWorkspaceName
import com.flashcardsopensourceapp.app.livesmoke.support.waitForCurrentWorkspaceScreenToSettle
import com.flashcardsopensourceapp.app.livesmoke.support.waitForSelectedWorkspaceSummary
import com.flashcardsopensourceapp.app.livesmoke.support.waitForSelectedWorkspaceSummaryToChange
import com.flashcardsopensourceapp.app.livesmoke.support.deleteCurrentWorkspaceErrorMessageOrNull
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.feature.settings.settingsCurrentWorkspaceRowTag
import com.flashcardsopensourceapp.feature.settings.settingsDeleteCurrentWorkspaceRowTag
import com.flashcardsopensourceapp.feature.settings.workspace.current.currentWorkspaceCreateButtonTag
import com.flashcardsopensourceapp.feature.settings.workspace.current.currentWorkspaceExistingRowTag
import com.flashcardsopensourceapp.feature.settings.workspace.current.currentWorkspaceListTag
import com.flashcardsopensourceapp.feature.settings.workspace.current.currentWorkspaceNameFieldTag
import com.flashcardsopensourceapp.feature.settings.workspace.current.currentWorkspaceSaveNameButtonTag
import com.flashcardsopensourceapp.feature.settings.workspace.delete.workspaceOverviewDeleteConfirmationButtonTag
import com.flashcardsopensourceapp.feature.settings.workspace.delete.workspaceOverviewDeleteConfirmationDialogTag
import com.flashcardsopensourceapp.feature.settings.workspace.delete.workspaceOverviewDeleteConfirmationErrorTag
import com.flashcardsopensourceapp.feature.settings.workspace.delete.workspaceOverviewDeleteConfirmationFieldTag
import com.flashcardsopensourceapp.feature.settings.workspace.delete.workspaceOverviewDeleteConfirmationLoadingTag
import com.flashcardsopensourceapp.feature.settings.workspace.delete.workspaceOverviewDeleteConfirmationPhraseTag
import com.flashcardsopensourceapp.feature.settings.workspace.delete.workspaceOverviewDeletePreviewBodyTag
import com.flashcardsopensourceapp.feature.settings.workspace.delete.workspaceOverviewDeletePreviewContinueButtonTag
import com.flashcardsopensourceapp.feature.settings.workspace.delete.workspaceOverviewDeletePreviewDialogTag
import com.flashcardsopensourceapp.feature.settings.workspace.delete.workspaceOverviewDeleteWorkspaceButtonTag
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

private const val linkedWorkspaceMutationTimeoutMillis: Long = 120_000L

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
    openSettingsRow(rowTag = settingsCurrentWorkspaceRowTag, rowLabel = "Workspace")
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
        timeoutMillis = linkedWorkspaceMutationTimeoutMillis,
        context = "after creating a linked workspace"
    )
    waitForSelectedWorkspaceSummaryToChange(
        beforeSummary = selectedWorkspaceSummaryBeforeCreate,
        context = "after creating a linked workspace",
        timeoutMillis = linkedWorkspaceMutationTimeoutMillis
    )
    waitForCurrentWorkspaceOperationToFinish(
        timeoutMillis = linkedWorkspaceMutationTimeoutMillis
    )
    waitForCurrentWorkspaceRenameReady(
        expectedWorkspaceName = workspaceName,
        requireExpectedWorkspaceName = false,
        context = "before renaming the linked workspace"
    )
    composeRule.onNodeWithTag(currentWorkspaceNameFieldTag).performTextReplacement(workspaceName)
    clickTag(tag = currentWorkspaceSaveNameButtonTag, label = "Save workspace name")
    waitForCurrentWorkspaceRenameOutcome(
        expectedWorkspaceName = workspaceName,
        timeoutMillis = linkedWorkspaceMutationTimeoutMillis
    )
    val renamedWorkspaceSelection: LinkedWorkspaceSelectionSnapshot = waitForLinkedWorkspaceName(
        expectedWorkspaceName = workspaceName,
        timeoutMillis = linkedWorkspaceMutationTimeoutMillis,
        context = "after renaming the linked workspace"
    )
    tapBackIcon()
    openSettingsRow(rowTag = settingsCurrentWorkspaceRowTag, rowLabel = "Workspace")
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
    openSettingsRow(rowTag = settingsCurrentWorkspaceRowTag, rowLabel = "Workspace")
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

    openSettingsRow(rowTag = settingsDeleteCurrentWorkspaceRowTag, rowLabel = "Delete current workspace")
    waitForDeleteCurrentWorkspaceReady(
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
    openSettingsRow(rowTag = settingsCurrentWorkspaceRowTag, rowLabel = "Workspace")
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
                "DeleteCurrentWorkspaceError=${deleteCurrentWorkspaceErrorMessageOrNull()} " +
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
    val appGraph: AppGraph = appGraph()
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

    openSettingsRow(rowTag = settingsCurrentWorkspaceRowTag, rowLabel = "Workspace")
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
            "DeleteCurrentWorkspaceError=${deleteCurrentWorkspaceErrorMessageOrNull()} " +
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
            isDeletePreviewDialogVisible() || deleteCurrentWorkspaceErrorMessageOrNull() != null
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Delete workspace preview did not resolve for '$workspaceName'. " +
                "DeleteCurrentWorkspaceError=${deleteCurrentWorkspaceErrorMessageOrNull()} " +
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
                "DeleteCurrentWorkspaceError=${deleteCurrentWorkspaceErrorMessageOrNull()}",
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
                "DeleteCurrentWorkspaceError=${deleteCurrentWorkspaceErrorMessageOrNull()} " +
                "CloudSettings=${currentCloudSettingsSummary()} " +
                "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.waitForCurrentWorkspaceOperationToFinish(timeoutMillis: Long) {
    waitForCurrentWorkspaceOperationToLeaveSwitchingState(timeoutMillis = timeoutMillis)
    try {
        waitUntilWithMitigation(
            timeoutMillis = timeoutMillis,
            context = "while waiting for current workspace operation to finish"
        ) {
            currentWorkspaceOperationMessageOrNull() == null &&
                currentWorkspaceNameOrNull() != "Unavailable" &&
                selectedWorkspaceSummaryOrNull() != null
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Workspace operation did not finish. " +
                "Operation=${currentWorkspaceOperationMessageOrNull()} " +
                "SelectedRow=${selectedWorkspaceSummaryOrNull()} " +
                "WorkspaceName=${currentWorkspaceNameOrNull()} " +
                "Error=${currentWorkspaceErrorMessageOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.waitForCurrentWorkspaceOperationToLeaveSwitchingState(
    timeoutMillis: Long
) {
    try {
        waitUntilWithMitigation(
            timeoutMillis = timeoutMillis,
            context = "while waiting for current workspace operation to leave switching"
        ) {
            currentWorkspaceOperationMessageOrNull()
                ?.startsWith(prefix = "Switching to")
                ?.not()
                ?: true
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Workspace operation stayed in SWITCHING without progressing. " +
                "Operation=${currentWorkspaceOperationMessageOrNull()} " +
                "SelectedRow=${selectedWorkspaceSummaryOrNull()} " +
                "WorkspaceName=${currentWorkspaceNameOrNull()} " +
                "Error=${currentWorkspaceErrorMessageOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.waitForCurrentWorkspaceRenameOutcome(
    expectedWorkspaceName: String,
    timeoutMillis: Long
) {
    try {
        waitUntilWithMitigation(
            timeoutMillis = timeoutMillis,
            context = "while waiting for workspace rename to persist"
        ) {
            currentWorkspaceNameFieldValueOrNull() == expectedWorkspaceName &&
                hasVisibleText(text = "Saving...", substring = false).not()
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Workspace rename did not persist on the Workspace screen. " +
                "FieldValue=${currentWorkspaceNameFieldValueOrNull()} " +
                "Error=${currentWorkspaceErrorMessageOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.waitForCurrentWorkspaceRenameReady(
    expectedWorkspaceName: String,
    requireExpectedWorkspaceName: Boolean,
    context: String
) {
    try {
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for current workspace rename readiness $context"
        ) {
            val workspaceNameFieldValue: String? = currentWorkspaceNameFieldValueOrNull()
            currentWorkspaceErrorMessageOrNull() == null &&
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
            "Workspace rename controls did not settle $context. " +
                "ExpectedWorkspaceName=$expectedWorkspaceName " +
                "FieldValue=${currentWorkspaceNameFieldValueOrNull()} " +
                "Error=${currentWorkspaceErrorMessageOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.waitForDeleteCurrentWorkspaceReady(
    expectedWorkspaceName: String,
    requireExpectedWorkspaceName: Boolean,
    context: String
) {
    try {
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for delete current workspace readiness $context"
        ) {
            deleteCurrentWorkspaceErrorMessageOrNull() == null &&
                hasVisibleText(text = "Loading", substring = true).not() &&
                (
                    requireExpectedWorkspaceName.not() ||
                        hasVisibleText(text = expectedWorkspaceName, substring = false)
                    )
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Delete current workspace screen did not settle $context. " +
                "ExpectedWorkspaceName=$expectedWorkspaceName " +
                "Error=${deleteCurrentWorkspaceErrorMessageOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.currentWorkspaceNameFieldValueOrNull(): String? {
    return composeRule.onAllNodesWithTag(currentWorkspaceNameFieldTag)
        .fetchSemanticsNodes()
        .firstOrNull()
        ?.config
        ?.getOrNull(SemanticsProperties.EditableText)
        ?.text
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
    val appGraph: AppGraph = appGraph()
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
