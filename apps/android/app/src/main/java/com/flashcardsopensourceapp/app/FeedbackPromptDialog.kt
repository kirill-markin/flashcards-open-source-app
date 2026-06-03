package com.flashcardsopensourceapp.app

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.feedback.CloudFeedbackTrigger

const val feedbackPromptDialogTag: String = "feedback_prompt_dialog"
const val feedbackPromptMessageFieldTag: String = "feedback_prompt_message_field"
const val feedbackPromptSendButtonTag: String = "feedback_prompt_send_button"
const val feedbackPromptDismissButtonTag: String = "feedback_prompt_dismiss_button"

@Composable
internal fun FeedbackPromptDialog(
    uiState: FeedbackPromptUiState,
    onMessageChange: (String) -> Unit,
    onShown: () -> Unit,
    onSubmit: () -> Unit,
    onDismiss: () -> Unit
) {
    val trimmedMessage = uiState.message.trim()
    LaunchedEffect(uiState.trigger) {
        onShown()
    }

    AlertDialog(
        onDismissRequest = {
            if (uiState.isSubmitting.not()) {
                onDismiss()
            }
        },
        confirmButton = {
            Button(
                onClick = onSubmit,
                enabled = trimmedMessage.isNotEmpty() && uiState.isSubmitting.not(),
                modifier = Modifier.testTag(tag = feedbackPromptSendButtonTag)
            ) {
                if (uiState.isSubmitting) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp
                    )
                } else {
                    Text(text = stringResource(id = R.string.feedback_prompt_send))
                }
            }
        },
        dismissButton = {
            TextButton(
                onClick = onDismiss,
                enabled = uiState.isSubmitting.not(),
                modifier = Modifier.testTag(tag = feedbackPromptDismissButtonTag)
            ) {
                Text(
                    text = stringResource(
                        id = when (uiState.trigger) {
                            CloudFeedbackTrigger.SETTINGS -> R.string.feedback_prompt_cancel
                            CloudFeedbackTrigger.AUTOMATIC -> R.string.feedback_prompt_not_now
                        }
                    )
                )
            }
        },
        title = {
            Text(text = stringResource(id = R.string.feedback_prompt_title))
        },
        text = {
            Column(
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(text = stringResource(id = R.string.feedback_prompt_body))
                OutlinedTextField(
                    value = uiState.message,
                    onValueChange = onMessageChange,
                    enabled = uiState.isSubmitting.not(),
                    label = {
                        Text(text = stringResource(id = R.string.feedback_prompt_message_label))
                    },
                    isError = uiState.errorMessage != null,
                    supportingText = {
                        if (uiState.errorMessage != null) {
                            Text(text = uiState.errorMessage)
                        }
                    },
                    minLines = 4,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag(tag = feedbackPromptMessageFieldTag)
                )
            }
        },
        modifier = Modifier.testTag(tag = feedbackPromptDialogTag)
    )
}
