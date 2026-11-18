package com.flashcardsopensourceapp.feature.settings.ai

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.ai.diagnostics.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.ai.remote.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.ai.AiChatCustomInstructionsScope
import com.flashcardsopensourceapp.data.local.model.ai.AiChatCustomInstructionsScopeChangedException
import com.flashcardsopensourceapp.data.local.repository.AiChatRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

sealed interface AiChatCustomInstructionsLoadState {
    data object Loading : AiChatCustomInstructionsLoadState
    data class Failed(val technicalDetails: String) : AiChatCustomInstructionsLoadState
    /** [scopeId] names the account and workspace the text belongs to. */
    data class Loaded(val scopeId: String, val savedText: String, val maxLength: Int) : AiChatCustomInstructionsLoadState
}

data class AiChatCustomInstructionsUiState(
    val loadState: AiChatCustomInstructionsLoadState,
    val isSaving: Boolean,
    /** Technical details of the last failed save; null when there is none. */
    val saveErrorDetails: String?,
    val didSave: Boolean
)

/** Edits the current workspace's custom instructions for the in-app AI chat; online only, nothing is stored on the device. */
class AiChatCustomInstructionsViewModel(
    private val aiChatRepository: AiChatRepository
) : ViewModel() {
    private val uiStateMutable = MutableStateFlow(
        value = AiChatCustomInstructionsUiState(
            loadState = AiChatCustomInstructionsLoadState.Loading,
            isSaving = false,
            saveErrorDetails = null,
            didSave = false
        )
    )
    val uiState: StateFlow<AiChatCustomInstructionsUiState> = uiStateMutable.asStateFlow()
    private val reloadRequests = MutableStateFlow(value = 0)
    /** The account and workspace the shown text was loaded for; saves go only there. */
    private var loadedScope: AiChatCustomInstructionsScope? = null

    init {
        viewModelScope.launch {
            // Follows the current account and workspace, so a restored editor never edits one the user left.
            combine(aiChatRepository.observeCustomInstructionsScope(), reloadRequests) { scope, _ -> scope }
                .collectLatest { scope ->
                    if (scope != null && scope != loadedScope) {
                        loadCurrent()
                    }
                }
        }
    }

    fun reload() {
        showLoading()
        reloadRequests.update { count -> count + 1 }
    }

    private suspend fun loadCurrent() {
        showLoading()
        try {
            val (scope, instructions) = aiChatRepository.loadCurrentCustomInstructions()
            loadedScope = scope
            uiStateMutable.update { state ->
                state.copy(
                    loadState = AiChatCustomInstructionsLoadState.Loaded(
                        scopeId = scope.scopeId,
                        savedText = instructions.customInstructions.orEmpty(),
                        maxLength = instructions.maxLength
                    )
                )
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            logFailure(event = "ai_chat_custom_instructions_load_failed", workspaceId = null, error = error)
            uiStateMutable.update { state ->
                state.copy(
                    loadState = AiChatCustomInstructionsLoadState.Failed(technicalDetails = error.message.orEmpty())
                )
            }
        }
    }

    private fun showLoading() {
        loadedScope = null
        uiStateMutable.update { state ->
            state.copy(loadState = AiChatCustomInstructionsLoadState.Loading, saveErrorDetails = null)
        }
    }

    fun save(text: String) {
        val scope = loadedScope ?: return
        if (uiStateMutable.value.isSaving) {
            return
        }
        uiStateMutable.update { state -> state.copy(isSaving = true, saveErrorDetails = null) }
        viewModelScope.launch {
            try {
                aiChatRepository.saveCustomInstructions(scope = scope, customInstructions = text)
                uiStateMutable.update { state -> state.copy(isSaving = false, didSave = true) }
            } catch (error: CancellationException) {
                throw error
            } catch (error: AiChatCustomInstructionsScopeChangedException) {
                uiStateMutable.update { state -> state.copy(isSaving = false) }
                reload()
            } catch (error: Exception) {
                logFailure(event = "ai_chat_custom_instructions_save_failed", workspaceId = scope.workspaceId, error = error)
                uiStateMutable.update { state ->
                    state.copy(isSaving = false, saveErrorDetails = error.message.orEmpty())
                }
            }
        }
    }

    private fun logFailure(event: String, workspaceId: String?, error: Exception) {
        val remoteError = error as? AiChatRemoteException
        AiChatDiagnosticsLogger.error(
            event = event,
            fields = listOf(
                "workspaceId" to workspaceId,
                "requestId" to remoteError?.requestId,
                "statusCode" to remoteError?.statusCode?.toString(),
                "code" to remoteError?.code
            ),
            throwable = error
        )
    }
}

fun createAiChatCustomInstructionsViewModelFactory(
    aiChatRepository: AiChatRepository
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            AiChatCustomInstructionsViewModel(aiChatRepository = aiChatRepository)
        }
    }
}
