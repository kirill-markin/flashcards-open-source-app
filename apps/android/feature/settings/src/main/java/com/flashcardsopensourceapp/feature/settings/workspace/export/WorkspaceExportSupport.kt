package com.flashcardsopensourceapp.feature.settings.workspace.export

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import androidx.core.content.FileProvider
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspaceExportData
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportDownloadResponse
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportDefaultPackageMetadata
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportMetadataInput
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportPreview
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportRequest
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportSelection
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportTagPolicyInput
import com.flashcardsopensourceapp.data.local.model.workspace.isWorkspacePackageExportGeneratedImportTag
import java.io.File
import java.time.LocalDate

private const val workspacePackageExportShareDirectoryName: String = "workspace-package-export"

data class WorkspacePackageExportMetadataDraft(
    val label: String,
    val author: String,
    val comment: String,
    val createdAt: String,
    val sourceUrl: String
)

internal data class WorkspacePackageExportTagOptionUiState(
    val tag: String,
    val cardsCount: Int,
    val isRemoved: Boolean,
    val isAlwaysRemoved: Boolean
)

fun makeWorkspaceExportFilename(workspaceName: String, date: LocalDate): String {
    val slug = workspaceName
        .trim()
        .lowercase()
        .replace(Regex("[^a-z0-9]+"), "-")
        .replace(Regex("^-+|-+$"), "")
        .ifEmpty { "workspace" }

    return "$slug-cards-export-$date.csv"
}

fun makeWorkspaceCardsCsv(exportData: WorkspaceExportData): String {
    val lines = listOf("frontText,backText,tags") + exportData.cards.map { card ->
        listOf(
            escapeWorkspaceExportCsvCell(card.frontText),
            escapeWorkspaceExportCsvCell(card.backText),
            escapeWorkspaceExportCsvCell(card.tags.joinToString(separator = ", "))
        ).joinToString(separator = ",")
    }

    return lines.joinToString(separator = "\r\n") + "\r\n"
}

fun makeDefaultWorkspacePackageExportPreviewRequest(): WorkspacePackageExportRequest {
    return WorkspacePackageExportRequest(
        selection = WorkspacePackageExportSelection.AllActiveCards,
        tagPolicy = WorkspacePackageExportTagPolicyInput(additionalRemovedTags = emptyList()),
        packageMetadata = WorkspacePackageExportMetadataInput(
            label = null,
            author = null,
            comment = null,
            createdAt = null,
            sourceUrl = null
        )
    )
}

fun makeWorkspacePackageExportMetadataDraft(
    defaultPackageMetadata: WorkspacePackageExportDefaultPackageMetadata
): WorkspacePackageExportMetadataDraft {
    return WorkspacePackageExportMetadataDraft(
        label = defaultPackageMetadata.label,
        author = defaultPackageMetadata.author ?: "",
        comment = defaultPackageMetadata.comment ?: "",
        createdAt = defaultPackageMetadata.createdAt,
        sourceUrl = defaultPackageMetadata.sourceUrl ?: ""
    )
}

fun makeWorkspacePackageExportInitialRemovedTags(preview: WorkspacePackageExportPreview): Set<String> {
    return (
        preview.tagsSelectedForRemoval.map { tagCount -> tagCount.tag } +
            preview.availableTagCounts
                .map { tagCount -> tagCount.tag }
                .filter { tag -> isWorkspacePackageExportGeneratedImportTag(tag = tag) }
        ).toSet()
}

fun makeWorkspacePackageExportRequest(
    preview: WorkspacePackageExportPreview,
    metadataDraft: WorkspacePackageExportMetadataDraft,
    removedTags: Set<String>
): WorkspacePackageExportRequest {
    return WorkspacePackageExportRequest(
        selection = WorkspacePackageExportSelection.AllActiveCards,
        tagPolicy = WorkspacePackageExportTagPolicyInput(
            additionalRemovedTags = makeWorkspacePackageExportRemovedTags(
                preview = preview,
                removedTags = removedTags
            )
        ),
        packageMetadata = WorkspacePackageExportMetadataInput(
            label = optionalWorkspacePackageExportMetadataText(value = metadataDraft.label),
            author = optionalWorkspacePackageExportMetadataText(value = metadataDraft.author),
            comment = optionalWorkspacePackageExportMetadataText(value = metadataDraft.comment),
            createdAt = optionalWorkspacePackageExportMetadataText(value = metadataDraft.createdAt),
            sourceUrl = optionalWorkspacePackageExportMetadataText(value = metadataDraft.sourceUrl)
        )
    )
}

internal fun makeWorkspacePackageExportTagOptions(
    preview: WorkspacePackageExportPreview,
    removedTags: Set<String>
): List<WorkspacePackageExportTagOptionUiState> {
    return preview.availableTagCounts.map { tagCount ->
        val isAlwaysRemoved: Boolean = isWorkspacePackageExportGeneratedImportTag(tag = tagCount.tag)
        WorkspacePackageExportTagOptionUiState(
            tag = tagCount.tag,
            cardsCount = tagCount.cardsCount,
            isRemoved = isAlwaysRemoved || removedTags.contains(tagCount.tag),
            isAlwaysRemoved = isAlwaysRemoved
        )
    }
}

fun writeWorkspaceExportCsv(
    contentResolver: ContentResolver,
    uri: Uri,
    csv: String
) {
    val outputStream = requireNotNull(contentResolver.openOutputStream(uri, "wt")) {
        "Android export destination is unavailable for writing."
    }

    outputStream.bufferedWriter(charset = Charsets.UTF_8).use { writer ->
        writer.write(csv)
        writer.flush()
    }
}

fun writeWorkspacePackageExportZip(
    contentResolver: ContentResolver,
    uri: Uri,
    packageBytes: ByteArray
) {
    val outputStream = requireNotNull(contentResolver.openOutputStream(uri, "wt")) {
        "Android package export destination is unavailable for writing."
    }

    outputStream.use { stream ->
        stream.write(packageBytes)
        stream.flush()
    }
}

fun prepareWorkspacePackageExportShareUri(
    context: Context,
    packageExport: WorkspacePackageExportDownloadResponse
): Uri {
    val fileName: String = requireSafeWorkspacePackageExportFileName(fileName = packageExport.fileName)
    val shareDirectory = File(context.cacheDir, workspacePackageExportShareDirectoryName)
    if (shareDirectory.exists().not() && shareDirectory.mkdirs().not()) {
        throw IllegalStateException(
            "Android package export share cache directory could not be created: ${shareDirectory.absolutePath}"
        )
    }
    if (shareDirectory.isDirectory.not()) {
        throw IllegalStateException(
            "Android package export share cache path is not a directory: ${shareDirectory.absolutePath}"
        )
    }

    val shareFile = File(shareDirectory, fileName)
    if (shareFile.exists() && shareFile.delete().not()) {
        throw IllegalStateException(
            "Android package export share file could not be replaced: ${shareFile.absolutePath}"
        )
    }
    shareFile.writeBytes(packageExport.packageBytes)

    return FileProvider.getUriForFile(
        context,
        "${context.packageName}.fileprovider",
        shareFile
    )
}

private fun makeWorkspacePackageExportRemovedTags(
    preview: WorkspacePackageExportPreview,
    removedTags: Set<String>
): List<String> {
    return preview.availableTagCounts
        .map { tagCount -> tagCount.tag }
        .filter { tag ->
            isWorkspacePackageExportGeneratedImportTag(tag = tag) || removedTags.contains(tag)
        }
}

private fun optionalWorkspacePackageExportMetadataText(value: String): String? {
    return value.trim().ifEmpty { null }
}

private fun requireSafeWorkspacePackageExportFileName(fileName: String): String {
    val trimmedFileName: String = fileName.trim()
    require(trimmedFileName.isNotEmpty()) {
        "Android package export share requires a non-empty filename."
    }
    require(trimmedFileName.contains("/").not() && trimmedFileName.contains("\\").not()) {
        "Android package export share filename must not contain path separators: $trimmedFileName"
    }
    require(trimmedFileName.any { character -> character.code < 32 || character.code == 127 }.not()) {
        "Android package export share filename must not contain control characters: $trimmedFileName"
    }
    return trimmedFileName
}

private fun escapeWorkspaceExportCsvCell(value: String): String {
    val escapedValue = value.replace(oldValue = "\"", newValue = "\"\"")
    if (
        escapedValue.contains(",")
        || escapedValue.contains("\"")
        || escapedValue.contains("\n")
        || escapedValue.contains("\r")
    ) {
        return "\"$escapedValue\""
    }

    return escapedValue
}
