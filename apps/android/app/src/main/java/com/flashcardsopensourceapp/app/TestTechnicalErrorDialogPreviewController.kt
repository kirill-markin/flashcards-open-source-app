package com.flashcardsopensourceapp.app

import com.flashcardsopensourceapp.core.ui.AppTechnicalError
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class TestTechnicalErrorDialogPreviewController {
    private val activePreviewTechnicalErrorFlow = MutableStateFlow<AppTechnicalError?>(value = null)

    val activePreviewTechnicalError: StateFlow<AppTechnicalError?> =
        activePreviewTechnicalErrorFlow.asStateFlow()

    fun showTestPreview(error: AppTechnicalError) {
        activePreviewTechnicalErrorFlow.value = error
    }

    fun dismissTestPreview() {
        activePreviewTechnicalErrorFlow.value = null
    }
}
