package com.flashcardsopensourceapp.feature.settings.workspace.importing

import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportPreview

data class WorkspaceImportUiState(
    val selectedFileName: String?,
    val preview: WorkspacePackageImportPreview?,
    val addImportTag: Boolean,
    val importTag: String,
    val removedTags: Set<String>,
    val isPreviewing: Boolean,
    val isImporting: Boolean,
    val availabilityMessage: String,
    val errorMessage: String,
    val successMessage: String
) {
    val isBusy: Boolean
        get() = isPreviewing || isImporting

    val canChoosePackage: Boolean
        get() = availabilityMessage.isEmpty() && isBusy.not()

    val canConfirmImport: Boolean
        get() = availabilityMessage.isEmpty() && preview != null && selectedFileName != null && isBusy.not()
}
