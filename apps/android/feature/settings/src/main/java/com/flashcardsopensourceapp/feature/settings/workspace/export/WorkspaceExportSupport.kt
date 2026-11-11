package com.flashcardsopensourceapp.feature.settings.workspace.export

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.core.content.FileProvider
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportDownloadResponse
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportDefaultPackageMetadata
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportMetadataInput
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportPreview
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportRequest
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportSelection
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportTagCount
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportTagPolicyInput
import com.flashcardsopensourceapp.data.local.model.workspace.isWorkspacePackageExportGeneratedImportTag
import java.io.Closeable
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.concurrent.TimeUnit

private const val workspacePackageExportDirectoryName: String = "workspace-package-export"
private const val workspacePackageExportSharePrefix: String = "share-"
private const val workspacePackageExportDownloadPrefix: String = "download-"
private val workspacePackageExportEntryLifetimeMillis: Long = TimeUnit.HOURS.toMillis(24)

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
    val isSelected: Boolean
)

fun makeWorkspacePackageExportPreviewRequest(selectedCardTags: Set<String>): WorkspacePackageExportRequest {
    return WorkspacePackageExportRequest(
        selection = makeWorkspacePackageExportSelection(selectedCardTags = selectedCardTags),
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

fun makeWorkspacePackageExportInitialIncludedTags(preview: WorkspacePackageExportPreview): Set<String> {
    return makeWorkspacePackageExportKnownRegularTags(preview = preview)
}

fun makeWorkspacePackageExportKnownRegularTags(preview: WorkspacePackageExportPreview): Set<String> {
    return makeWorkspacePackageExportAvailableRegularTags(preview = preview).toSet()
}

fun makeWorkspacePackageExportRefreshedIncludedTags(
    knownRegularTags: Set<String>,
    includedTags: Set<String>,
    refreshedPreview: WorkspacePackageExportPreview
): Set<String> {
    val excludedKnownTags: Set<String> = knownRegularTags - includedTags
    val includedRefreshedTags: Set<String> = makeWorkspacePackageExportAvailableRegularTags(preview = refreshedPreview)
        .filter { tag -> excludedKnownTags.contains(tag).not() }
        .toSet()
    return includedTags + includedRefreshedTags
}

fun makeWorkspacePackageExportRequest(
    preview: WorkspacePackageExportPreview,
    metadataDraft: WorkspacePackageExportMetadataDraft,
    selectedCardTags: Set<String>,
    includedTags: Set<String>
): WorkspacePackageExportRequest {
    return WorkspacePackageExportRequest(
        selection = makeWorkspacePackageExportSelection(selectedCardTags = selectedCardTags),
        tagPolicy = WorkspacePackageExportTagPolicyInput(
            additionalRemovedTags = makeWorkspacePackageExportAdditionalRemovedTags(
                preview = preview,
                includedTags = includedTags
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

internal fun makeWorkspacePackageExportCardSelectionTagOptions(
    tagCounts: List<WorkspacePackageExportTagCount>,
    selectedTags: Set<String>
): List<WorkspacePackageExportTagOptionUiState> {
    return tagCounts.map { tagCount ->
        WorkspacePackageExportTagOptionUiState(
            tag = tagCount.tag,
            cardsCount = tagCount.cardsCount,
            isSelected = selectedTags.contains(tagCount.tag)
        )
    }
}

internal fun makeWorkspacePackageExportIncludedTagOptions(
    preview: WorkspacePackageExportPreview,
    includedTags: Set<String>
): List<WorkspacePackageExportTagOptionUiState> {
    return preview.availableTagCounts
        .filter { tagCount -> isWorkspacePackageExportGeneratedImportTag(tag = tagCount.tag).not() }
        .map { tagCount ->
            WorkspacePackageExportTagOptionUiState(
                tag = tagCount.tag,
                cardsCount = tagCount.cardsCount,
                isSelected = includedTags.contains(tagCount.tag)
            )
        }
}

internal data class WorkspacePackageExportShare(
    val uri: Uri,
    val directory: File
)

internal fun createWorkspacePackageExportFile(destinationDirectory: File): File {
    val exportDirectory = File(destinationDirectory, workspacePackageExportDirectoryName)
    Files.createDirectories(exportDirectory.toPath())
    val expiresBefore = System.currentTimeMillis() - workspacePackageExportEntryLifetimeMillis
    exportDirectory.listFiles()?.forEach { entry ->
        if ((entry.name.startsWith(workspacePackageExportSharePrefix) ||
                entry.name.startsWith(workspacePackageExportDownloadPrefix)) &&
            entry.lastModified() < expiresBefore
        ) {
            deleteWorkspacePackageExportEntry(entry = entry)
        }
    }
    return File.createTempFile(workspacePackageExportDownloadPrefix, ".tmp", exportDirectory)
}

internal class WorkspacePackageExportSave(
    val fileName: String,
    val archiveInput: FileInputStream
) : Closeable {
    override fun close() {
        try {
            archiveInput.close()
        } catch (error: IOException) {
            Log.w("WorkspacePackageExport", "Could not close a staged export.", error)
        }
    }
}

internal fun openWorkspacePackageExportSave(
    packageExport: WorkspacePackageExportDownloadResponse
): WorkspacePackageExportSave {
    val save = WorkspacePackageExportSave(
        fileName = packageExport.fileName,
        archiveInput = packageExport.archiveFile.inputStream()
    )
    try {
        // The open descriptor retains the bytes until it closes, including while the picker is open.
        Files.deleteIfExists(packageExport.archiveFile.toPath())
        return save
    } catch (error: Exception) {
        save.close()
        throw error
    }
}

internal fun writeWorkspacePackageExport(
    contentResolver: ContentResolver,
    uri: Uri,
    archiveInput: FileInputStream
) {
    val firstByte = archiveInput.read()
    if (firstByte == -1) {
        throw IOException("Android package export archive is empty.")
    }
    val outputStream = requireNotNull(contentResolver.openOutputStream(uri, "wt")) {
        "Android package export destination is unavailable for writing."
    }
    outputStream.use { output ->
        output.write(firstByte)
        archiveInput.copyTo(output)
    }
}

internal fun prepareWorkspacePackageExportShare(
    context: Context,
    packageExport: WorkspacePackageExportDownloadResponse
): WorkspacePackageExportShare {
    val fileName = requireSafeWorkspacePackageExportFileName(fileName = packageExport.fileName)
    val archiveFile = packageExport.archiveFile.toPath()
    val shareDirectory = Files.createTempDirectory(archiveFile.parent, workspacePackageExportSharePrefix)
    val shareFile = shareDirectory.resolve(fileName)
    try {
        Files.move(archiveFile, shareFile, StandardCopyOption.ATOMIC_MOVE)
        return WorkspacePackageExportShare(
            uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", shareFile.toFile()),
            directory = shareDirectory.toFile()
        )
    } catch (error: Exception) {
        deleteWorkspacePackageExportEntry(entry = shareDirectory.toFile())
        throw error
    }
}

internal fun deleteWorkspacePackageExportEntry(entry: File) {
    if (entry.deleteRecursively().not()) {
        Log.w("WorkspacePackageExport", "Could not remove a staged export.")
    }
}

private fun makeWorkspacePackageExportSelection(selectedCardTags: Set<String>): WorkspacePackageExportSelection {
    val normalizedSelectedCardTags: List<String> = selectedCardTags
        .map { tag -> tag.trim() }
        .filter { tag -> tag.isNotEmpty() }
        .distinct()
        .sorted()
    if (normalizedSelectedCardTags.isEmpty()) {
        return WorkspacePackageExportSelection.AllActiveCards
    }
    return WorkspacePackageExportSelection.TagFilters(
        includeTags = normalizedSelectedCardTags,
        excludeTags = emptyList()
    )
}

private fun makeWorkspacePackageExportAvailableRegularTags(preview: WorkspacePackageExportPreview): List<String> {
    return preview.availableTagCounts
        .map { tagCount -> tagCount.tag }
        .filter { tag -> isWorkspacePackageExportGeneratedImportTag(tag = tag).not() }
}

private fun makeWorkspacePackageExportAdditionalRemovedTags(
    preview: WorkspacePackageExportPreview,
    includedTags: Set<String>
): List<String> {
    return preview.availableTagCounts
        .map { tagCount -> tagCount.tag }
        .filter { tag ->
            isWorkspacePackageExportGeneratedImportTag(tag = tag).not() && includedTags.contains(tag).not()
        }
}

private fun optionalWorkspacePackageExportMetadataText(value: String): String? {
    return value.trim().ifEmpty { null }
}

private fun requireSafeWorkspacePackageExportFileName(fileName: String): String {
    val trimmedFileName: String = fileName.trim()
    require(trimmedFileName.isNotEmpty() && trimmedFileName != "." && trimmedFileName != "..") {
        "Android package export share requires a valid filename."
    }
    require(trimmedFileName.contains("/").not() && trimmedFileName.contains("\\").not()) {
        "Android package export share filename must not contain path separators: $trimmedFileName"
    }
    require(trimmedFileName.any { character -> character.code < 32 || character.code == 127 }.not()) {
        "Android package export share filename must not contain control characters: $trimmedFileName"
    }
    return trimmedFileName
}
