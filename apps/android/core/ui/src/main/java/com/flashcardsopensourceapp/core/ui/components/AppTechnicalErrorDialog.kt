package com.flashcardsopensourceapp.core.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.core.ui.AppTechnicalError

const val appTechnicalErrorDialogTag: String = "app_technical_error_dialog"
const val appTechnicalErrorDetailsButtonTag: String = "app_technical_error_details_button"
const val appTechnicalErrorDetailsTextTag: String = "app_technical_error_details_text"
const val appTechnicalErrorDismissButtonTag: String = "app_technical_error_dismiss_button"

@Composable
fun AppTechnicalErrorDialog(
    error: AppTechnicalError,
    showDetailsLabel: String,
    hideDetailsLabel: String,
    dismissLabel: String,
    onDismiss: () -> Unit
) {
    var isShowingDetails by rememberSaveable(
        error.title,
        error.message,
        error.technicalDetails
    ) {
        mutableStateOf(value = false)
    }
    val hasTechnicalDetails = error.technicalDetails.isNotBlank()

    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(
                onClick = onDismiss,
                modifier = Modifier.testTag(tag = appTechnicalErrorDismissButtonTag)
            ) {
                Text(text = dismissLabel)
            }
        },
        title = {
            Text(text = error.title)
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    text = error.message,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                if (hasTechnicalDetails) {
                    TextButton(
                        onClick = { isShowingDetails = isShowingDetails.not() },
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag(tag = appTechnicalErrorDetailsButtonTag)
                    ) {
                        Text(
                            text = if (isShowingDetails) {
                                hideDetailsLabel
                            } else {
                                showDetailsLabel
                            }
                        )
                    }

                    AnimatedVisibility(visible = isShowingDetails) {
                        SelectionContainer {
                            Text(
                                text = error.technicalDetails,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier.testTag(tag = appTechnicalErrorDetailsTextTag)
                            )
                        }
                    }
                }
            }
        },
        modifier = Modifier.testTag(tag = appTechnicalErrorDialogTag)
    )
}
