package com.flashcardsopensourceapp.feature.review

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable

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
            Text("Use Again for unknown answers")
        },
        text = {
            Text(
                "If you did not know the answer, choose \"Again\". \"Hard\" is only for answers you knew but it was difficult to recall."
            )
        },
        confirmButton = {
            TextButton(onClick = onDismissRequest) {
                Text("OK")
            }
        }
    )
}
