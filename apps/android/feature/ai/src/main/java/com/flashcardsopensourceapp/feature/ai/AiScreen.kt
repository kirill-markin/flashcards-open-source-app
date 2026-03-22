package com.flashcardsopensourceapp.feature.ai

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.core.ui.components.DraftNoticeCard

@Composable
fun AiRoute(
    uiState: AiUiState,
    onDraftMessageChange: (String) -> Unit,
    onSendDraftMessage: () -> Unit
) {
    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        item {
            DraftNoticeCard(
                title = "Android draft AI shell",
                body = "This screen is intentionally honest: it shows a native Android chat layout before the real AI runtime is ported from iOS.",
                modifier = Modifier
            )
        }

        items(uiState.messages, key = { message -> message.messageId }) { message ->
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.padding(16.dp)
                ) {
                    Text(
                        text = message.author,
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.primary
                    )
                    Text(
                        text = message.text,
                        style = MaterialTheme.typography.bodyLarge
                    )
                }
            }
        }

        item {
            OutlinedTextField(
                value = uiState.draftMessage,
                onValueChange = onDraftMessageChange,
                label = {
                    Text("Draft prompt")
                },
                minLines = 3,
                modifier = Modifier.fillMaxWidth()
            )
        }

        item {
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Button(
                    onClick = onSendDraftMessage,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Send draft message")
                }
            }
        }
    }
}
