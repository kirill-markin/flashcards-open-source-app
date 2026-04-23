package com.flashcardsopensourceapp.data.local.repository

import android.util.Log

private const val progressRepositoryLogTag: String = "ProgressRepository"
private const val progressRepositoryLogMaxValueLength: Int = 240

internal fun logProgressRepositoryWarning(
    event: String,
    fields: List<Pair<String, String?>>,
    error: Throwable
) {
    val message = buildProgressRepositoryLogMessage(
        event = event,
        fields = fields
    )
    val didLog = runCatching {
        Log.w(progressRepositoryLogTag, message, error)
    }.isSuccess
    if (didLog.not()) {
        println("$progressRepositoryLogTag W $message")
        println(error.stackTraceToString())
    }
}

private fun buildProgressRepositoryLogMessage(
    event: String,
    fields: List<Pair<String, String?>>
): String {
    val renderedFields = fields.map { (key, value) ->
        "$key=${sanitizeProgressRepositoryLogValue(value = value)}"
    }

    return if (renderedFields.isEmpty()) {
        "event=$event"
    } else {
        "event=$event ${renderedFields.joinToString(separator = " ")}"
    }
}

private fun sanitizeProgressRepositoryLogValue(
    value: String?
): String {
    if (value == null) {
        return "null"
    }

    val normalized = value.replace(oldValue = "\n", newValue = "\\n")
    return if (normalized.length <= progressRepositoryLogMaxValueLength) {
        normalized
    } else {
        normalized.take(progressRepositoryLogMaxValueLength) + "..."
    }
}
