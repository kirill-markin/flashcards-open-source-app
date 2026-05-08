package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.defaultAiChatServerConfig
import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState
import com.flashcardsopensourceapp.feature.ai.AiUiState
import com.flashcardsopensourceapp.feature.ai.strings.testAiTextProvider
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AiUiStateMapperTest {
    @Test
    fun acceptedActiveRunKeepsDraftPreparationEnabledButSendBlocked() {
        val runtimeState = makeAiDraftState(
            workspaceId = defaultTestWorkspaceId,
            persistedState = makeDefaultAiChatPersistedState()
        ).copy(
            activeRun = makeActiveRun(runId = "run-1", cursor = "0"),
            composerPhase = AiComposerPhase.RUNNING,
            draftMessage = "Next draft"
        )

        val uiState = mapRuntimeState(runtimeState = runtimeState)

        assertTrue(uiState.isStreaming)
        assertTrue(uiState.isComposerBusy)
        assertTrue(uiState.isCardHandoffReady)
        assertTrue(uiState.canEditDraftText)
        assertTrue(uiState.canEditDraft)
        assertTrue(uiState.canManageDraftAttachments)
        assertTrue(uiState.canAddDraftAttachment)
        assertTrue(uiState.canToggleDictation)
        assertFalse(uiState.canSend)
    }

    @Test
    fun preAcceptAndStoppingPhasesLockDraftPreparation() {
        val lockedPhases: List<AiComposerPhase> = listOf(
            AiComposerPhase.PREPARING_SEND,
            AiComposerPhase.STARTING_RUN,
            AiComposerPhase.STOPPING
        )

        lockedPhases.forEach { composerPhase ->
            val runtimeState = makeAiDraftState(
                workspaceId = defaultTestWorkspaceId,
                persistedState = makeDefaultAiChatPersistedState()
            ).copy(
                activeRun = if (composerPhase == AiComposerPhase.STOPPING) {
                    makeActiveRun(runId = "run-1", cursor = "0")
                } else {
                    null
                },
                composerPhase = composerPhase,
                draftMessage = "Blocked draft"
            )

            val uiState = mapRuntimeState(runtimeState = runtimeState)

            assertFalse(uiState.isCardHandoffReady)
            assertFalse(uiState.canEditDraftText)
            assertFalse(uiState.canEditDraft)
            assertFalse(uiState.canManageDraftAttachments)
            assertFalse(uiState.canAddDraftAttachment)
            assertFalse(uiState.canToggleDictation)
            assertFalse(uiState.canSend)
        }
    }

    @Test
    fun featureFlagsDisableAddingAttachmentsAndStartingDictation() {
        val chatConfig = defaultAiChatServerConfig.copy(
            features = defaultAiChatServerConfig.features.copy(
                dictationEnabled = false,
                attachmentsEnabled = false
            )
        )
        val runtimeState = makeAiDraftState(
            workspaceId = defaultTestWorkspaceId,
            persistedState = makeDefaultAiChatPersistedState().copy(
                lastKnownChatConfig = chatConfig
            )
        )

        val uiState = mapRuntimeState(runtimeState = runtimeState)

        assertTrue(uiState.canEditDraftText)
        assertTrue(uiState.canEditDraft)
        assertTrue(uiState.canManageDraftAttachments)
        assertFalse(uiState.canAddDraftAttachment)
        assertFalse(uiState.canToggleDictation)
    }

    @Test
    fun activeDictationKeepsTextEditableButLocksDraftActions() {
        val activeStates: List<AiChatDictationState> = listOf(
            AiChatDictationState.REQUESTING_PERMISSION,
            AiChatDictationState.RECORDING,
            AiChatDictationState.TRANSCRIBING
        )
        val editableComposerPhases: List<AiComposerPhase> = listOf(
            AiComposerPhase.IDLE,
            AiComposerPhase.STOPPING
        )

        activeStates.forEach { dictationState ->
            editableComposerPhases.forEach { composerPhase ->
                val runtimeState = makeAiDraftState(
                    workspaceId = defaultTestWorkspaceId,
                    persistedState = makeDefaultAiChatPersistedState()
                ).copy(
                    activeRun = if (composerPhase == AiComposerPhase.STOPPING) {
                        makeActiveRun(runId = "run-1", cursor = "0")
                    } else {
                        null
                    },
                    composerPhase = composerPhase,
                    dictationState = dictationState,
                    draftMessage = "Typed while recording"
                )

                val uiState = mapRuntimeState(runtimeState = runtimeState)

                assertTrue(uiState.canEditDraftText)
                assertFalse(uiState.canEditDraft)
                assertFalse(uiState.canManageDraftAttachments)
                assertFalse(uiState.canAddDraftAttachment)
                if (dictationState == AiChatDictationState.RECORDING) {
                    assertTrue(uiState.canToggleDictation)
                } else {
                    assertFalse(uiState.canToggleDictation)
                }
                assertFalse(uiState.canSend)
                assertFalse(uiState.canStartNewChat)
            }
        }
    }

    private fun mapRuntimeState(runtimeState: AiChatRuntimeState): AiUiState {
        return mapToAiUiState(
            metadata = initialAiAppMetadataSummary(textProvider = testAiTextProvider()),
            cloudState = CloudAccountState.GUEST,
            isCloudIdentityBlocked = false,
            hasConsent = true,
            runtimeState = runtimeState,
            textProvider = testAiTextProvider()
        )
    }
}
