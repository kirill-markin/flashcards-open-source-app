package com.flashcardsopensourceapp.core.ui

data class AppTechnicalError(
    val title: String,
    val message: String,
    val technicalDetails: String
)

interface AppTechnicalErrorController {
    fun showTechnicalError(
        error: AppTechnicalError,
        throwable: Throwable
    )
}
