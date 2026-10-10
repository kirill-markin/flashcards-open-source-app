package com.flashcardsopensourceapp.data.local.ai.store

import android.content.Context
import java.io.File
import java.io.IOException
import java.util.UUID

private const val aiChatStagedAttachmentDirectoryName: String = "ai-chat-attachments"

/**
 * The app-cache files that hold picked chat attachments until the turn that uploads them is accepted.
 * Only chat drafts reference them, so a reset that clears the drafts has to delete them as well.
 */
class AiChatStagedAttachmentStore(
    context: Context
) {
    private val directory: File = File(context.cacheDir, aiChatStagedAttachmentDirectoryName)

    /** A new location for one attachment's bytes, which the caller writes. */
    fun makeFile(): File {
        directory.mkdirs()
        return File(directory, UUID.randomUUID().toString())
    }

    /** Call before clearing the drafts: an import still running lands only while its staged file exists. */
    fun deleteAll() {
        if (directory.deleteRecursively().not()) {
            throw IOException("Staged AI chat attachments could not be deleted from ${directory.path}.")
        }
    }
}
