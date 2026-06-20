package com.flashcardsopensourceapp.core.ui

import java.util.concurrent.atomic.AtomicLong

private val appTechnicalErrorReportIdSequence = AtomicLong(0L)

data class AppTechnicalError(
    val reportId: String,
    val title: String,
    val message: String,
    val technicalDetails: String
)

fun makeAppTechnicalError(
    title: String,
    message: String,
    throwable: Throwable
): AppTechnicalError {
    return AppTechnicalError(
        reportId = nextAppTechnicalErrorReportId(source = "app-technical-error"),
        title = title,
        message = message,
        technicalDetails = renderTechnicalErrorDetails(error = throwable)
    )
}

fun nextAppTechnicalErrorReportId(source: String): String {
    val normalizedSource = source.trim().ifEmpty { "technical-error" }
    return "$normalizedSource:${appTechnicalErrorReportIdSequence.incrementAndGet()}"
}

interface AppTechnicalErrorController {
    fun showTechnicalError(
        error: AppTechnicalError,
        throwable: Throwable
    )
}
