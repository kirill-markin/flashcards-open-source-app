package com.flashcardsopensourceapp.feature.ai.ui

import android.app.Activity
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.draganddrop.dragAndDropTarget
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draganddrop.DragAndDropEvent
import androidx.compose.ui.draganddrop.DragAndDropTarget
import androidx.compose.ui.draganddrop.mimeTypes
import androidx.compose.ui.draganddrop.toAndroidDragEvent
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.ai.AiChatAttachment
import com.flashcardsopensourceapp.feature.ai.R
import com.flashcardsopensourceapp.feature.ai.input.attachAiChatContentUri
import com.flashcardsopensourceapp.feature.ai.input.isAiChatImageContentUri
import com.flashcardsopensourceapp.feature.ai.runtime.errors.AiAlertState
import com.flashcardsopensourceapp.feature.ai.strings.AiTextProvider

/** Takes files dropped from another app anywhere over [content], with an overlay while one hovers. */
@Composable
internal fun AiChatDropTarget(
    isDropAllowed: Boolean,
    onDrop: (DragAndDropEvent) -> Boolean,
    modifier: Modifier,
    content: @Composable () -> Unit
) {
    val currentIsDropAllowed by rememberUpdatedState(isDropAllowed)
    val currentOnDrop by rememberUpdatedState(onDrop)
    var isDragHovering by remember { mutableStateOf(value = false) }
    val dropTarget = remember {
        object : DragAndDropTarget {
            override fun onEntered(event: DragAndDropEvent) {
                isDragHovering = true
            }

            override fun onExited(event: DragAndDropEvent) {
                isDragHovering = false
            }

            override fun onEnded(event: DragAndDropEvent) {
                isDragHovering = false
            }

            override fun onDrop(event: DragAndDropEvent): Boolean {
                isDragHovering = false
                return currentIsDropAllowed && currentOnDrop(event)
            }
        }
    }

    Box(
        modifier = modifier.dragAndDropTarget(
            shouldStartDragAndDrop = { event ->
                currentIsDropAllowed && isAiChatAttachableDrag(event = event)
            },
            target = dropTarget
        )
    ) {
        content()
        if (isDragHovering && isDropAllowed) {
            AiChatDropOverlay(modifier = Modifier.fillMaxSize())
        }
    }
}

/**
 * Only the description is readable before the drop, and a file manager types a text file by its own
 * MIME type, so a plain text drag shows the overlay too and its drop is refused for carrying no URI.
 * The system's app, shortcut, and task drags start split screen instead.
 */
private fun isAiChatAttachableDrag(event: DragAndDropEvent): Boolean {
    return event.mimeTypes().any { mimeType ->
        mimeType.startsWith(prefix = "application/vnd.android.").not()
    }
}

/**
 * Attaches every content URI a drop carries; false when it carried none. A cross-app URI is readable
 * only while the drop's permissions are held, so they are released once every copy is made.
 */
internal fun attachDroppedAiChatContent(
    activity: Activity,
    event: DragAndDropEvent,
    textProvider: AiTextProvider,
    onAddPendingAttachment: (AiChatAttachment) -> Unit,
    onImportPendingAttachment: (suspend () -> AiChatAttachment) -> Unit,
    onShowAlert: (AiAlertState) -> Unit
): Boolean {
    val dragEvent = event.toAndroidDragEvent()
    val clipData = dragEvent.clipData ?: return false
    val uris = (0 until clipData.itemCount).mapNotNull { index -> clipData.getItemAt(index).uri }
    if (uris.isEmpty()) {
        return false
    }

    val permissions = activity.requestDragAndDropPermissions(dragEvent)
    // Images are copied before their routing returns, so they go first. The runtime then stages one
    // document at a time and refuses the rest, so that staging is the last read and releases the
    // permissions. A staging refused or cancelled before it starts keeps them until the activity ends.
    val (imageUris, documentUris) = uris.partition { uri ->
        isAiChatImageContentUri(context = activity, uri = uri)
    }
    var isHeldByDocumentStaging = false
    (imageUris + documentUris).forEach { uri ->
        attachAiChatContentUri(
            context = activity,
            uri = uri,
            textProvider = textProvider,
            onAddPendingAttachment = onAddPendingAttachment,
            onImportPendingAttachment = { stageAttachment ->
                isHeldByDocumentStaging = true
                onImportPendingAttachment {
                    try {
                        stageAttachment()
                    } finally {
                        permissions?.release()
                    }
                }
            },
            onShowAlert = onShowAlert
        )
    }
    if (isHeldByDocumentStaging.not()) {
        permissions?.release()
    }
    return true
}

@Composable
private fun AiChatDropOverlay(modifier: Modifier) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.92f),
        shape = MaterialTheme.shapes.extraLarge,
        border = BorderStroke(width = 2.dp, color = MaterialTheme.colorScheme.primary),
        modifier = modifier.padding(12.dp)
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp, alignment = Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Icon(
                imageVector = Icons.Outlined.AttachFile,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary
            )
            Text(
                text = stringResource(id = R.string.ai_drop_overlay),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface
            )
        }
    }
}
