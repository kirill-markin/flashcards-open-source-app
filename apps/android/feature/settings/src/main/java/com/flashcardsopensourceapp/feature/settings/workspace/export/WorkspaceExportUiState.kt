package com.flashcardsopensourceapp.feature.settings.workspace.export

import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportPreview

data class WorkspaceExportUiState(
    val workspaceName: String,
    val activeCardsCount: Int,
    val isExporting: Boolean,
    val packagePreview: WorkspacePackageExportPreview?,
    val packageMetadataDraft: WorkspacePackageExportMetadataDraft,
    val packageRemovedTags: Set<String>,
    val isPackagePreviewing: Boolean,
    val isPackageExporting: Boolean,
    val packageAvailabilityMessage: String,
    val errorMessage: String
) {
    val isBusy: Boolean
        get() = isExporting || isPackagePreviewing || isPackageExporting

    val canPreviewPackageExport: Boolean
        get() = packageAvailabilityMessage.isEmpty() && isBusy.not()

    val canExportPackage: Boolean
        get() = packageAvailabilityMessage.isEmpty() && packagePreview != null && isBusy.not()
}
