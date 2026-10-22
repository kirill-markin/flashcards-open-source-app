package com.flashcardsopensourceapp.feature.cards.editor

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Card
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.core.ui.content.MathText

@Composable
internal fun NavigationSummaryCard(
    modifier: Modifier,
    title: String,
    summary: String,
    supportingText: String,
    icon: @Composable () -> Unit,
    onClick: () -> Unit,
    contentSource: String? = null
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
    ) {
        ListItem(
            headlineContent = {
                Text(title)
            },
            supportingContent = {
                Column(
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    if (contentSource == null) {
                        Text(summary)
                    } else {
                        MathText(text = contentSource, plainText = summary)
                    }
                    Text(
                        text = supportingText,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            },
            leadingContent = icon
        )
    }
}
