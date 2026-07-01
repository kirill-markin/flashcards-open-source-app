package com.flashcardsopensourceapp.data.local.model.workspace

const val workspacePackageExportGeneratedImportTagPrefix: String = "import:"

sealed interface WorkspacePackageExportSelection {
    data object AllActiveCards : WorkspacePackageExportSelection

    data class TagFilters(
        val includeTags: List<String>,
        val excludeTags: List<String>
    ) : WorkspacePackageExportSelection

    data class ExplicitCardIds(
        val cardIds: List<String>
    ) : WorkspacePackageExportSelection
}

data class WorkspacePackageExportTagPolicyInput(
    val additionalRemovedTags: List<String>
)

data class WorkspacePackageExportMetadataInput(
    val label: String?,
    val author: String?,
    val comment: String?,
    val createdAt: String?,
    val sourceUrl: String?
)

data class WorkspacePackageExportRequest(
    val selection: WorkspacePackageExportSelection,
    val tagPolicy: WorkspacePackageExportTagPolicyInput,
    val packageMetadata: WorkspacePackageExportMetadataInput
)

data class WorkspacePackageExportTagCount(
    val tag: String,
    val cardsCount: Int
)

data class WorkspacePackageExportDefaultPackageMetadata(
    val label: String,
    val author: String?,
    val comment: String?,
    val createdAt: String,
    val sourceUrl: String?
)

data class WorkspacePackageExportPreview(
    val selectedCardCount: Int,
    val availableTagCounts: List<WorkspacePackageExportTagCount>,
    val tagsSelectedForRemoval: List<WorkspacePackageExportTagCount>,
    val referencedMediaCount: Int,
    val approximateReferencedMediaBytes: Long,
    val defaultPackageMetadata: WorkspacePackageExportDefaultPackageMetadata
)

data class WorkspacePackageExportDownloadResponse(
    val packageBytes: ByteArray,
    val fileName: String,
    val contentType: String
)

fun isWorkspacePackageExportGeneratedImportTag(tag: String): Boolean {
    return tag.startsWith(prefix = workspacePackageExportGeneratedImportTagPrefix)
}
