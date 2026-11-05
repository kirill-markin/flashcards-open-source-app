package com.flashcardsopensourceapp.feature.ai.toolcall

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.ai.AiChatToolCallStatus
import com.flashcardsopensourceapp.feature.ai.strings.aiTextProvider

internal val aiTranscriptRowIndent = 8.dp

/**
 * One muted line for a tool call or reasoning step. A completed step shows no status text;
 * a running one shows a small spinner.
 */
@Composable
internal fun AiTranscriptDisclosureRow(
    label: String,
    status: AiChatToolCallStatus,
    isExpanded: Boolean,
    onClickLabel: String?,
    onToggle: () -> Unit,
    labelModifier: Modifier,
    statusModifier: Modifier,
    modifier: Modifier
) {
    val context = LocalContext.current
    val textProvider = remember(context) { aiTextProvider(context = context) }
    val contentColor = MaterialTheme.colorScheme.onSurfaceVariant

    Row(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .fillMaxWidth()
            .minimumInteractiveComponentSize()
            .clip(shape = MaterialTheme.shapes.small)
            .clickable(
                onClickLabel = onClickLabel,
                role = Role.Button,
                onClick = onToggle
            )
            .padding(horizontal = aiTranscriptRowIndent, vertical = 4.dp)
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = contentColor,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = labelModifier.weight(weight = 1f, fill = false)
        )
        if (status == AiChatToolCallStatus.STARTED) {
            val runningDescription = formatAiToolCallStatus(status = status, textProvider = textProvider)
            CircularProgressIndicator(
                color = contentColor,
                strokeWidth = 1.5.dp,
                modifier = statusModifier
                    .size(size = 12.dp)
                    .semantics {
                        contentDescription = runningDescription
                    }
            )
        }
        Icon(
            imageVector = if (isExpanded) {
                Icons.Outlined.ExpandLess
            } else {
                Icons.Outlined.ExpandMore
            },
            contentDescription = null,
            tint = contentColor,
            modifier = Modifier.size(size = 18.dp)
        )
    }
}
