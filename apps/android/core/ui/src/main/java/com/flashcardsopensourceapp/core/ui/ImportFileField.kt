package com.flashcardsopensourceapp.core.ui

import android.app.Activity
import android.content.ContentResolver
import android.net.Uri
import androidx.compose.foundation.draganddrop.dragAndDropTarget
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draganddrop.DragAndDropEvent
import androidx.compose.ui.draganddrop.DragAndDropTarget
import androidx.compose.ui.draganddrop.mimeTypes
import androidx.compose.ui.draganddrop.toAndroidDragEvent
import kotlinx.coroutines.Job

@Composable
fun ImportFileField(
    activity: Activity?,
    label: String,
    supportingContent: @Composable () -> Unit,
    enabled: Boolean,
    onClick: () -> Unit,
    onDrop: (List<Uri>) -> Job?,
    modifier: Modifier,
    trailingContent: (@Composable () -> Unit)?
) {
    val currentActivity by rememberUpdatedState(activity)
    val currentEnabled by rememberUpdatedState(enabled)
    val currentOnDrop by rememberUpdatedState(onDrop)
    var isHovering by remember { mutableStateOf(false) }
    val target = remember {
        object : DragAndDropTarget {
            override fun onEntered(event: DragAndDropEvent) {
                isHovering = true
            }

            override fun onExited(event: DragAndDropEvent) {
                isHovering = false
            }

            override fun onEnded(event: DragAndDropEvent) {
                isHovering = false
            }

            override fun onDrop(event: DragAndDropEvent): Boolean {
                isHovering = false
                val host = currentActivity ?: return false
                if (!currentEnabled) return false
                val dragEvent = event.toAndroidDragEvent()
                val clip = dragEvent.clipData ?: return false
                val uris = (0 until clip.itemCount).mapNotNull { index ->
                    clip.getItemAt(index).uri?.takeIf { uri -> uri.scheme == ContentResolver.SCHEME_CONTENT }
                }
                if (uris.isEmpty() || uris.size != clip.itemCount) return false

                val permissions = host.requestDragAndDropPermissions(dragEvent)
                val readJob = currentOnDrop(uris)
                if (readJob == null) {
                    permissions?.release()
                    return false
                }
                readJob.invokeOnCompletion { permissions?.release() }
                return true
            }
        }
    }

    val containerColor = if (isHovering && enabled) {
        MaterialTheme.colorScheme.primaryContainer
    } else {
        MaterialTheme.colorScheme.surface
    }
    OutlinedCard(
        onClick = onClick,
        enabled = enabled,
        colors = CardDefaults.outlinedCardColors(
            containerColor = containerColor,
            disabledContainerColor = containerColor
        ),
        modifier = modifier
            .fillMaxWidth()
            .dragAndDropTarget(
                shouldStartDragAndDrop = { event ->
                    currentEnabled && currentActivity != null &&
                        event.mimeTypes().any { type -> !type.startsWith("application/vnd.android.") }
                },
                target = target
            )
    ) {
        ListItem(
            headlineContent = { Text(label) },
            supportingContent = supportingContent,
            trailingContent = trailingContent,
            colors = ListItemDefaults.colors(containerColor = containerColor)
        )
    }
}
