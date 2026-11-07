package com.flashcardsopensourceapp.feature.ai.input

import android.content.Context
import android.net.Uri
import com.flashcardsopensourceapp.data.local.model.ai.AiChatAttachment
import com.flashcardsopensourceapp.feature.ai.runtime.errors.AiAlertState
import com.flashcardsopensourceapp.feature.ai.strings.AiTextProvider
import com.flashcardsopensourceapp.feature.settings.access.AccessCapability

/**
 * Attaches one content URI handed over outside the pickers, such as a drop or a paste: an image
 * takes the Choose Photo path and anything else the Choose File path, so both keep the pickers'
 * type, size, and error handling. Reports neither analytics half, because neither picker's source is true.
 */
private fun attachAiChatContentUri(
    context: Context,
    uri: Uri,
    textProvider: AiTextProvider,
    onAddPendingAttachment: (AiChatAttachment) -> Unit,
    onImportPendingAttachment: (suspend () -> AiChatAttachment) -> Unit,
    onShowAlert: (AiAlertState) -> Unit
) {
    if (isAiChatImageContentUri(context = context, uri = uri)) {
        addAiChatImageAttachmentFromUri(
            context = context,
            uri = uri,
            textProvider = textProvider,
            onAddPendingAttachment = onAddPendingAttachment,
            onShowAlert = onShowAlert
        )
        return
    }

    importAiChatDocumentAttachmentFromUri(
        context = context,
        uri = uri,
        textProvider = textProvider,
        onImportPendingAttachment = onImportPendingAttachment
    )
}

/**
 * Attaches every content URI of one paste or drop. Images are copied before their routing returns, so
 * they go first: the runtime refuses new attachments while a document is staging, and it stages one
 * document at a time, refusing the rest with its busy alert. That staging is the last read of [uris].
 */
internal fun attachAiChatContentUris(
    context: Context,
    uris: List<Uri>,
    textProvider: AiTextProvider,
    onAddPendingAttachment: (AiChatAttachment) -> Unit,
    onImportPendingAttachment: (suspend () -> AiChatAttachment) -> Unit,
    onShowAlert: (AiAlertState) -> Unit
) {
    val (imageUris, documentUris) = uris.partition { uri ->
        isAiChatImageContentUri(context = context, uri = uri)
    }
    (imageUris + documentUris).forEach { uri ->
        attachAiChatContentUri(
            context = context,
            uri = uri,
            textProvider = textProvider,
            onAddPendingAttachment = onAddPendingAttachment,
            onImportPendingAttachment = onImportPendingAttachment,
            onShowAlert = onShowAlert
        )
    }
}

/** The same type the image path checks, so an image routed there is never refused there. */
private fun isAiChatImageContentUri(context: Context, uri: Uri): Boolean {
    return context.contentResolver.getType(uri)?.trim()?.startsWith(prefix = "image/") == true
}

/**
 * Alerts on failure itself and returns the outcome, so only a caller that knows its source reports
 * the analytics halves.
 */
internal fun addAiChatImageAttachmentFromUri(
    context: Context,
    uri: Uri,
    textProvider: AiTextProvider,
    onAddPendingAttachment: (AiChatAttachment) -> Unit,
    onShowAlert: (AiAlertState) -> Unit
): Result<Unit> {
    return try {
        onAddPendingAttachment(
            makeAiChatImageAttachmentFromUri(
                context = context,
                uri = uri,
                textProvider = textProvider
            )
        )
        Result.success(value = Unit)
    } catch (error: Exception) {
        onShowAlert(
            aiAttachmentImportAlert(
                capability = AccessCapability.PHOTOS,
                error = error,
                textProvider = textProvider
            )
        )
        Result.failure(exception = error)
    }
}

internal fun importAiChatDocumentAttachmentFromUri(
    context: Context,
    uri: Uri,
    textProvider: AiTextProvider,
    onImportPendingAttachment: (suspend () -> AiChatAttachment) -> Unit
) {
    // The staging outlives this screen, so it holds the application context, never the activity.
    val applicationContext = context.applicationContext
    onImportPendingAttachment {
        makeAiChatDocumentAttachmentFromUri(
            context = applicationContext,
            uri = uri,
            textProvider = textProvider
        )
    }
}
