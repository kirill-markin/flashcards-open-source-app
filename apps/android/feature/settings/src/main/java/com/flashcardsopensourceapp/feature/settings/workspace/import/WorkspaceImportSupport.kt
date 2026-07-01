package com.flashcardsopensourceapp.feature.settings.workspace.importing

import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportConfirmOptions
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportConfirmSummary
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportPreview
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import java.io.ByteArrayOutputStream
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import java.util.Locale

private const val workspaceImportMaximumZipBytes: Long = 4_000_000L
private const val workspaceImportMaximumZipMegabytes: Int = 4
private const val workspaceImportReadBufferBytes: Int = 64 * 1024

internal data class WorkspaceImportSelectedFile(
    val fileName: String,
    val packageBytes: ByteArray
)

internal data class WorkspaceImportTagOptionUiState(
    val tag: String,
    val cardsCount: Int,
    val isKept: Boolean
)

internal class WorkspaceImportUserException(
    message: String,
    cause: Throwable?
) : Exception(message, cause)

internal fun workspaceImportDocumentPickerMimeTypes(): Array<String> {
    return arrayOf(
        "application/zip",
        "application/x-zip-compressed",
        "application/octet-stream"
    )
}

internal fun readWorkspaceImportSelectedFile(
    context: Context,
    uri: Uri,
    strings: SettingsStringResolver
): WorkspaceImportSelectedFile {
    return try {
        readWorkspaceImportSelectedFileUnchecked(
            context = context,
            uri = uri,
            strings = strings
        )
    } catch (error: WorkspaceImportUserException) {
        throw error
    } catch (error: SecurityException) {
        throw WorkspaceImportUserException(
            message = strings.get(R.string.settings_import_file_read_failed),
            cause = error
        )
    } catch (error: IllegalArgumentException) {
        throw WorkspaceImportUserException(
            message = strings.get(R.string.settings_import_file_read_failed),
            cause = error
        )
    }
}

private fun readWorkspaceImportSelectedFileUnchecked(
    context: Context,
    uri: Uri,
    strings: SettingsStringResolver
): WorkspaceImportSelectedFile {
    val fileName: String = queryDisplayName(context = context, uri = uri)
        ?: throw WorkspaceImportUserException(
            message = strings.get(R.string.settings_import_file_name_unavailable),
            cause = null
        )
    val trimmedFileName: String = fileName.trim()
    if (trimmedFileName.lowercase(Locale.US).endsWith(".zip").not()) {
        throw WorkspaceImportUserException(
            message = strings.get(R.string.settings_import_invalid_file),
            cause = null
        )
    }

    val declaredSizeBytes: Long? = querySizeBytes(context = context, uri = uri)
    if (declaredSizeBytes != null && declaredSizeBytes > workspaceImportMaximumZipBytes) {
        throw WorkspaceImportUserException(
            message = strings.get(R.string.settings_import_file_too_large, workspaceImportMaximumZipMegabytes),
            cause = null
        )
    }

    val packageBytes: ByteArray = readWorkspaceImportBytes(
        context = context,
        uri = uri,
        strings = strings
    )
    if (packageBytes.isEmpty()) {
        throw WorkspaceImportUserException(
            message = strings.get(R.string.settings_import_file_empty),
            cause = null
        )
    }
    if (packageBytes.size.toLong() > workspaceImportMaximumZipBytes) {
        throw WorkspaceImportUserException(
            message = strings.get(R.string.settings_import_file_too_large, workspaceImportMaximumZipMegabytes),
            cause = null
        )
    }

    return WorkspaceImportSelectedFile(
        fileName = trimmedFileName,
        packageBytes = packageBytes.copyOf()
    )
}

internal fun makeWorkspaceImportTagOptions(
    preview: WorkspacePackageImportPreview,
    removedTags: Set<String>
): List<WorkspaceImportTagOptionUiState> {
    return preview.tagCounts.map { tagCount ->
        WorkspaceImportTagOptionUiState(
            tag = tagCount.tag,
            cardsCount = tagCount.cardsCount,
            isKept = removedTags.contains(tagCount.tag).not()
        )
    }
}

internal fun makeWorkspaceImportConfirmOptions(
    preview: WorkspacePackageImportPreview,
    addImportTag: Boolean,
    removedTags: Set<String>,
    importedAtMillis: Long,
    importId: String,
    missingImportTagMessage: String
): WorkspacePackageImportConfirmOptions {
    val importTag: String = preview.defaultOptions.suggestedImportTag.trim()
    if (importTag.isEmpty()) {
        throw WorkspaceImportUserException(
            message = missingImportTagMessage,
            cause = null
        )
    }

    return WorkspacePackageImportConfirmOptions(
        addImportTag = addImportTag,
        importTag = importTag,
        removeTags = makeWorkspaceImportRemovedTags(
            preview = preview,
            removedTags = removedTags
        ),
        importedAtMillis = importedAtMillis,
        importId = importId,
        clientUpdatedAtMillis = importedAtMillis,
        operationIdPrefix = importId
    )
}

internal fun workspaceImportSuccessMessage(
    summary: WorkspacePackageImportConfirmSummary,
    strings: SettingsStringResolver
): String {
    val importTag: String? = summary.importTag?.trim()?.ifEmpty { null }
    if (importTag != null) {
        return strings.getQuantity(
            R.plurals.settings_import_success_with_tag,
            summary.cardCount,
            summary.cardCount,
            importTag
        )
    }
    return strings.getQuantity(
        R.plurals.settings_import_success,
        summary.cardCount,
        summary.cardCount
    )
}

private fun makeWorkspaceImportRemovedTags(
    preview: WorkspacePackageImportPreview,
    removedTags: Set<String>
): List<String> {
    return preview.tagCounts
        .map { tagCount -> tagCount.tag }
        .filter { tag -> removedTags.contains(tag) }
}

private fun readWorkspaceImportBytes(
    context: Context,
    uri: Uri,
    strings: SettingsStringResolver
): ByteArray {
    return try {
        context.contentResolver.openInputStream(uri)?.use { inputStream ->
            readWorkspaceImportBytesBounded(
                inputStream = inputStream,
                maximumBytes = workspaceImportMaximumZipBytes,
                tooLargeMessage = strings.get(
                    R.string.settings_import_file_too_large,
                    workspaceImportMaximumZipMegabytes
                )
            )
        } ?: throw WorkspaceImportUserException(
            message = strings.get(R.string.settings_import_file_read_failed),
            cause = null
        )
    } catch (error: WorkspaceImportUserException) {
        throw error
    } catch (error: FileNotFoundException) {
        throw WorkspaceImportUserException(
            message = strings.get(R.string.settings_import_file_read_failed),
            cause = error
        )
    } catch (error: SecurityException) {
        throw WorkspaceImportUserException(
            message = strings.get(R.string.settings_import_file_read_failed),
            cause = error
        )
    } catch (error: IOException) {
        throw WorkspaceImportUserException(
            message = strings.get(R.string.settings_import_file_read_failed),
            cause = error
        )
    }
}

private fun readWorkspaceImportBytesBounded(
    inputStream: InputStream,
    maximumBytes: Long,
    tooLargeMessage: String
): ByteArray {
    val outputStream = ByteArrayOutputStream()
    val buffer = ByteArray(workspaceImportReadBufferBytes)
    var totalBytes = 0L

    while (true) {
        val readCount: Int = inputStream.read(buffer)
        if (readCount == -1) {
            break
        }
        totalBytes += readCount.toLong()
        if (totalBytes > maximumBytes) {
            throw WorkspaceImportUserException(message = tooLargeMessage, cause = null)
        }
        outputStream.write(buffer, 0, readCount)
    }

    return outputStream.toByteArray()
}

private fun queryDisplayName(
    context: Context,
    uri: Uri
): String? {
    return queryOpenableColumn(context = context, uri = uri, columnName = OpenableColumns.DISPLAY_NAME) { cursor, index ->
        cursor.getString(index)?.trim()?.ifEmpty { null }
    }
}

private fun querySizeBytes(
    context: Context,
    uri: Uri
): Long? {
    return queryOpenableColumn(context = context, uri = uri, columnName = OpenableColumns.SIZE) { cursor, index ->
        if (cursor.isNull(index)) {
            null
        } else {
            cursor.getLong(index)
        }
    }
}

private fun <T> queryOpenableColumn(
    context: Context,
    uri: Uri,
    columnName: String,
    readValue: (Cursor, Int) -> T?
): T? {
    val cursor: Cursor = context.contentResolver.query(
        uri,
        arrayOf(columnName),
        null,
        null,
        null
    ) ?: return null

    cursor.use {
        if (it.moveToFirst().not()) {
            return null
        }
        val columnIndex: Int = it.getColumnIndex(columnName)
        if (columnIndex == -1) {
            return null
        }
        return readValue(it, columnIndex)
    }
}
