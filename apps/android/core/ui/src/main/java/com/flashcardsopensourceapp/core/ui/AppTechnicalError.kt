package com.flashcardsopensourceapp.core.ui

data class AppTechnicalError(
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
        title = title,
        message = message,
        technicalDetails = technicalDetailsForAppError(throwable = throwable)
    )
}

private fun technicalDetailsForAppError(throwable: Throwable): String {
    val stackTrace = throwable.stackTraceToString().trim()
    if (stackTrace.isNotEmpty()) {
        return stackTrace
    }

    val message = throwable.message
    if (message.isNullOrBlank()) {
        return throwable::class.java.name
    }

    return "${throwable::class.java.name}: $message"
}

interface AppTechnicalErrorController {
    fun showTechnicalError(
        error: AppTechnicalError,
        throwable: Throwable
    )
}
