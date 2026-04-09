package com.flashcardsopensourceapp.feature.settings

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun CloudSignInErrorCard(
    message: String,
    technicalDetails: String?,
    modifier: Modifier
) {
    var isShowingDetails by rememberSaveable(message, technicalDetails) {
        mutableStateOf(false)
    }

    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.errorContainer
        )
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(20.dp)
        ) {
            Text(
                text = message,
                color = MaterialTheme.colorScheme.onErrorContainer
            )

            if (technicalDetails.isNullOrBlank().not()) {
                TextButton(
                    onClick = { isShowingDetails = isShowingDetails.not() },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = if (isShowingDetails) {
                            "Hide technical details"
                        } else {
                            "Show technical details"
                        }
                    )
                }

                AnimatedVisibility(visible = isShowingDetails) {
                    SelectionContainer {
                        Text(
                            text = technicalDetails.orEmpty(),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onErrorContainer
                        )
                    }
                }
            }
        }
    }
}
