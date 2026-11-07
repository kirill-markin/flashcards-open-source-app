package com.flashcardsopensourceapp.feature.ai.input

import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow

/**
 * The field's own text state, kept in step with the ViewModel draft that stays the source of truth.
 * The ViewModel echoes every edit back asynchronously, so an echo of an edit the field has already
 * moved past is skipped instead of overwriting newer text and moving the cursor. Only a draft the
 * field never produced, such as the clear after sending, a restored draft, a suggestion, or
 * dictation, is written into the field, and that write is not reported back as an edit. The field
 * starts from the draft whenever it enters composition and keeps no saved copy that could overwrite it.
 * Echoes are matched by value and the draft can skip values, so the pending edits are dropped whenever
 * the field and the draft agree, leaving none to swallow a later draft.
 */
@Composable
internal fun rememberAiComposerDraftTextState(
    draftMessage: String,
    onDraftMessageChange: (String) -> Unit
): TextFieldState {
    val textFieldState = remember { TextFieldState(initialText = draftMessage) }
    val currentDraftMessage by rememberUpdatedState(draftMessage)
    val currentOnDraftMessageChange by rememberUpdatedState(onDraftMessageChange)
    val draftSync = remember { AiComposerDraftSync(viewModelDraft = draftMessage) }

    LaunchedEffect(textFieldState) {
        snapshotFlow { textFieldState.text.toString() }.collect { text ->
            if (text != draftSync.viewModelDraft) {
                draftSync.viewModelDraft = text
                if (text == currentDraftMessage) {
                    draftSync.unechoedEdits.clear()
                } else {
                    draftSync.unechoedEdits.addLast(text)
                }
                currentOnDraftMessageChange(text)
            }
        }
    }

    LaunchedEffect(draftMessage) {
        val echoIndex = draftSync.unechoedEdits.indexOf(element = draftMessage)
        if (echoIndex >= 0) {
            repeat(times = echoIndex + 1) { draftSync.unechoedEdits.removeFirst() }
            if (textFieldState.text.toString() == draftMessage) {
                draftSync.unechoedEdits.clear()
            }
            return@LaunchedEffect
        }

        draftSync.unechoedEdits.clear()
        draftSync.viewModelDraft = draftMessage
        if (textFieldState.text.toString() != draftMessage) {
            textFieldState.setTextAndPlaceCursorAtEnd(text = draftMessage)
        }
    }

    return textFieldState
}

/** Read and written only from the composition's own coroutines, which run one at a time. */
private class AiComposerDraftSync(var viewModelDraft: String) {
    val unechoedEdits: ArrayDeque<String> = ArrayDeque()
}
