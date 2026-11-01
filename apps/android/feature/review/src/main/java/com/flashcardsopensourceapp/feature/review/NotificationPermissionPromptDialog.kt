package com.flashcardsopensourceapp.feature.review

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource

/** The after-review notifications pre-prompt; [continueAction] picks the "Continue" or "Open Settings" text. */
@Composable
fun NotificationPermissionPromptDialog(
    continueAction: NotificationPermissionPromptContinueAction,
    onContinue: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(stringResource(id = R.string.review_notification_prompt_title))
        },
        text = {
            Text(stringResource(id = R.string.review_notification_prompt_body))
        },
        confirmButton = {
            TextButton(onClick = onContinue) {
                Text(
                    stringResource(
                        id = when (continueAction) {
                            NotificationPermissionPromptContinueAction.REQUEST_PERMISSION -> R.string.review_continue
                            NotificationPermissionPromptContinueAction.OPEN_NOTIFICATION_SETTINGS -> R.string.review_open_settings
                        }
                    )
                )
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(id = R.string.review_not_now))
            }
        }
    )
}
