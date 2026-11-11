package com.flashcardsopensourceapp.feature.settings.workspace.export

import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportFormat
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportPreview
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportTagCount

data class WorkspaceExportUiState(
    val format: WorkspacePackageExportFormat,
    val packagePreview: WorkspacePackageExportPreview?,
    val packageMetadataDraft: WorkspacePackageExportMetadataDraft,
    val packageCardSelectionTags: Set<String>,
    val packageCardSelectionTagCounts: List<WorkspacePackageExportTagCount>,
    val packageIncludedTags: Set<String>,
    val isPackagePreviewing: Boolean,
    val isPackageExporting: Boolean,
    val packageAvailabilityMessage: String,
    val errorMessage: String
) {
    val isBusy: Boolean
        get() = isPackagePreviewing || isPackageExporting

    val canPreviewPackageExport: Boolean
        get() = packageAvailabilityMessage.isEmpty() && isBusy.not()

    val isAnkiSelectionEmpty: Boolean
        get() = packagePreview?.isAnkiSelectionEmpty(format = format) == true

    val canExportPackage: Boolean
        get() = canPreviewPackageExport && packagePreview != null && isAnkiSelectionEmpty.not()
}

internal fun WorkspacePackageExportPreview.isAnkiSelectionEmpty(format: WorkspacePackageExportFormat): Boolean {
    return format == WorkspacePackageExportFormat.ANKI && selectedCardCount == 0
}
