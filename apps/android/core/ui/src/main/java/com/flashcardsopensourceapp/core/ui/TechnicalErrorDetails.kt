package com.flashcardsopensourceapp.core.ui

fun renderTechnicalErrorDetails(error: Throwable): String {
    return renderTechnicalErrorDetails(
        errorType = error::class.java.name,
        message = error.message
    )
}

fun renderTechnicalErrorDetails(
    errorType: String,
    message: String?
): String {
    val trimmedErrorType = errorType.trim().ifEmpty { "TechnicalError" }
    val trimmedMessage = message?.trim().orEmpty()
    if (trimmedMessage.isEmpty()) {
        return trimmedErrorType
    }
    return "$trimmedErrorType: $trimmedMessage"
}
