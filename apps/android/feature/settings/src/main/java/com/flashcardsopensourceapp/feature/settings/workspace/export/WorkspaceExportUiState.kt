package com.flashcardsopensourceapp.feature.settings.workspace.export

import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportPreview
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportTagCount

data class WorkspaceExportUiState(
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

    val canExportPackage: Boolean
        get() = packageAvailabilityMessage.isEmpty() && packagePreview != null && isBusy.not()
}
