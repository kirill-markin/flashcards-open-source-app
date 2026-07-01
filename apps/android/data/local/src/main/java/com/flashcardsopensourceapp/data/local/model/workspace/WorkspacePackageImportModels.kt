package com.flashcardsopensourceapp.data.local.model.workspace

enum class WorkspacePackageImportSourceKind {
    ZIP
}

data class WorkspacePackageImportSource(
    val kind: WorkspacePackageImportSourceKind,
    val title: String
)

data class WorkspacePackageImportMetadata(
    val label: String?,
    val author: String?,
    val comment: String?,
    val createdAt: String?,
    val sourceUrl: String?
)

data class WorkspacePackageImportTagCount(
    val tag: String,
    val cardsCount: Int
)

data class WorkspacePackageImportWarning(
    val code: String,
    val message: String,
    val mediaPath: String
)

data class WorkspacePackageImportDefaultOptions(
    val addImportTag: Boolean,
    val suggestedImportTag: String,
    val keptTags: List<String>,
    val removedTags: List<String>
)

data class WorkspacePackageImportPreview(
    val sourceKind: WorkspacePackageImportSourceKind,
    val packageMetadata: WorkspacePackageImportMetadata,
    val cardCount: Int,
    val tagCounts: List<WorkspacePackageImportTagCount>,
    val referencedMediaCount: Int,
    val packageMediaFileCount: Int,
    val warnings: List<WorkspacePackageImportWarning>,
    val defaultOptions: WorkspacePackageImportDefaultOptions
)

data class WorkspacePackageImportConfirmOptions(
    val addImportTag: Boolean,
    val importTag: String,
    val removeTags: List<String>,
    val importedAtMillis: Long,
    val importId: String,
    val clientUpdatedAtMillis: Long,
    val operationIdPrefix: String
)

data class WorkspacePackageImportConfirmSummary(
    val cardCount: Int,
    val cardBatchCount: Int,
    val referencedMediaCount: Int,
    val importedMediaAssetCount: Int,
    val appliedMediaAssetCount: Int,
    val keptTagCount: Int,
    val removedTagCount: Int,
    val importTag: String?
)

data class WorkspacePackageImportConfirmResult(
    val summary: WorkspacePackageImportConfirmSummary
)
