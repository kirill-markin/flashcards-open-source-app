package com.flashcardsopensourceapp.feature.ai

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.util.UUID

class AiViewModel : ViewModel() {
    private val mutableUiState = MutableStateFlow(
        value = AiUiState(
            messages = listOf(
                AiMessage(
                    messageId = "seed-user",
                    author = "You",
                    text = "Help me turn this note into flashcards."
                ),
                AiMessage(
                    messageId = "seed-assistant",
                    author = "AI",
                    text = "This Android draft keeps the chat shell native, while real provider, consent, attachments, and streaming logic are still marked for porting."
                )
            ),
            draftMessage = "",
            isSending = false
        )
    )

    val uiState: StateFlow<AiUiState> = mutableUiState.asStateFlow()

    fun updateDraftMessage(draftMessage: String) {
        mutableUiState.update { state ->
            state.copy(draftMessage = draftMessage)
        }
    }

    fun sendDraftMessage() {
        val message = mutableUiState.value.draftMessage.trim()
        if (message.isEmpty()) {
            return
        }

        // TODO: Port AI provider/session runtime from apps/ios/Flashcards/Flashcards/AI/AIChatSessionRuntime.swift.
        // TODO: Port consent gate from apps/ios/Flashcards/Flashcards/AI/AIChatView.swift.
        // TODO: Port attachments, camera, files, and dictation flows from apps/ios/Flashcards/Flashcards/AI.
        // TODO: Port streaming and tool-call history persistence from apps/ios/Flashcards/Flashcards/AI/AIChatStore.swift.
        mutableUiState.update { state ->
            state.copy(
                draftMessage = "",
                messages = state.messages + listOf(
                    AiMessage(
                        messageId = UUID.randomUUID().toString(),
                        author = "You",
                        text = message
                    ),
                    AiMessage(
                        messageId = UUID.randomUUID().toString(),
                        author = "AI",
                        text = "Draft response only: real AI transport is intentionally not wired in this first Android prototype."
                    )
                )
            )
        }
    }
}

fun createAiViewModelFactory(): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            AiViewModel()
        }
    }
}
