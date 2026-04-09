package com.flashcardsopensourceapp.feature.review

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource

/**
 * Native Material dialog that reminds the user which answer button to use.
 */
@Composable
internal fun HardAnswerReminderDialog(
    onDismissRequest: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismissRequest,
        title = {
            Text(stringResource(id = R.string.review_hard_answer_reminder_title))
        },
        text = {
            Text(stringResource(id = R.string.review_hard_answer_reminder_body))
        },
        confirmButton = {
            TextButton(onClick = onDismissRequest) {
                Text(stringResource(id = R.string.review_ok))
            }
        }
    )
}
