package com.flashcardsopensourceapp.app.observability

private const val sentrySafeValueMaxLength: Int = 160
private const val sentryContextValueMaxLength: Int = 320
private const val sentryRedactedValue: String = "[redacted]"
private const val sentryRedactedQueryValue: String = "[redacted-query]"

internal fun sanitizeSentryTagValue(
    fieldName: String,
    value: String?
): String? {
    return sanitizeSentryString(fieldName = fieldName, value = value, maxLength = sentrySafeValueMaxLength)
}

internal fun sanitizeSentryContextValue(
    fieldName: String,
    value: String?
): String? {
    return sanitizeSentryString(fieldName = fieldName, value = value, maxLength = sentryContextValueMaxLength)
}

internal fun sanitizeSentryIdentifier(value: String?): String? {
    return sanitizeSentryString(fieldName = "identifier", value = value, maxLength = sentrySafeValueMaxLength)
}

internal fun sanitizeSentryLogValue(
    fieldName: String,
    value: String?
): String {
    return sanitizeSentryString(fieldName = fieldName, value = value, maxLength = sentrySafeValueMaxLength) ?: "null"
}

internal fun sanitizeSentryText(
    fieldName: String,
    value: String
): String {
    return sanitizeSentryString(fieldName = fieldName, value = value, maxLength = sentryContextValueMaxLength)
        ?: sentryRedactedValue
}

internal fun renderSanitizedThrowableLogFields(error: Throwable): String {
    val cause = error.cause
    return "throwableType=${sanitizeSentryLogValue(fieldName = "throwableType", value = error::class.java.name)} " +
        "throwableMessage=${sanitizeThrowableLogMessage(value = error.message)} " +
        "topFrame=${sanitizeSentryLogValue(fieldName = "topFrame", value = topStackFrame(error = error))} " +
        "causeType=${sanitizeSentryLogValue(fieldName = "causeType", value = cause?.let { causeError -> causeError::class.java.name })} " +
        "causeMessage=${sanitizeThrowableLogMessage(value = cause?.message)} " +
        "stackTrace=${sanitizeSentryLogValue(fieldName = "stackTrace", value = compactStackTrace(error = error))}"
}

internal fun sanitizeSentryUrl(value: String?): String? {
    val normalizedValue = value?.trim()?.ifEmpty { null } ?: return null
    val sanitizedValue = sanitizeSentryString(
        fieldName = "url",
        value = normalizedValue,
        maxLength = sentryContextValueMaxLength
    ) ?: return null
    val queryStart = sanitizedValue.indexOf(char = '?')
    val fragmentStart = sanitizedValue.indexOf(char = '#')
    val firstSensitivePart = listOf(queryStart, fragmentStart)
        .filter { index -> index >= 0 }
        .minOrNull()

    return if (firstSensitivePart == null) {
        sanitizedValue
    } else {
        sanitizedValue.take(n = firstSensitivePart)
    }
}

internal fun sanitizeSentryQueryString(value: String?): String? {
    val normalizedValue = value?.trim()?.ifEmpty { null } ?: return null
    val sanitizedValue = sanitizeSentryString(
        fieldName = "queryString",
        value = normalizedValue,
        maxLength = sentryContextValueMaxLength
    )
    return if (sanitizedValue == null) {
        null
    } else {
        sentryRedactedQueryValue
    }
}

internal fun isUnsafeSentryFieldName(fieldName: String): Boolean {
    val normalizedName: String = normalizeSentryFieldName(fieldName = fieldName)
    return normalizedName.contains("token") ||
        normalizedName.contains("authorization") ||
        normalizedName.contains("cookie") ||
        normalizedName.contains("email") ||
        normalizedName.contains("password") ||
        normalizedName.contains("secret") ||
        normalizedName.contains("apikey") ||
        normalizedName.contains("query") ||
        normalizedName.contains("fragment")
}

private fun normalizeSentryFieldName(fieldName: String): String {
    return fieldName.lowercase().filter { character: Char -> character.isLetterOrDigit() }
}

private fun sanitizeSentryString(
    fieldName: String,
    value: String?,
    maxLength: Int
): String? {
    if (value.isNullOrBlank()) {
        return null
    }
    if (isUnsafeSentryFieldName(fieldName = fieldName)) {
        return sentryRedactedValue
    }

    val withoutLineBreaks = value.replace(oldValue = "\n", newValue = " ").replace(oldValue = "\r", newValue = " ")
    val withoutRawBodies = rawBodyPattern.replace(input = withoutLineBreaks, replacement = "\$1$sentryRedactedValue")
    val withoutUrlQueries = urlQueryPattern.replace(input = withoutRawBodies, replacement = "\$1?$sentryRedactedQueryValue")
    val withoutQueryParameters = queryParameterPattern.replace(input = withoutUrlQueries, replacement = "\$1=$sentryRedactedValue")
    val withoutAuthHeaders = authHeaderPattern.replace(input = withoutQueryParameters, replacement = "\$1=$sentryRedactedValue")
    val withoutEmails = emailPattern.replace(input = withoutAuthHeaders, replacement = "[redacted-email]")
    val withoutJwt = jwtPattern.replace(input = withoutEmails, replacement = "[redacted-token]")
    val withoutLongBase64 = base64LikePattern.replace(input = withoutJwt, replacement = "[redacted-base64]")
    val trimmedValue = withoutLongBase64.trim()

    return if (trimmedValue.length <= maxLength) {
        trimmedValue
    } else {
        trimmedValue.take(n = maxLength) + "..."
    }
}

private fun compactStackTrace(error: Throwable): String? {
    val frames = error.stackTrace.take(n = 6)
    if (frames.isEmpty()) {
        return null
    }
    return frames.joinToString(separator = "|") { frame ->
        "${frame.className}.${frame.methodName}:${frame.lineNumber}"
    }
}

private fun sanitizeThrowableLogMessage(value: String?): String {
    return if (value.isNullOrBlank()) {
        "null"
    } else {
        sentryRedactedValue
    }
}

private fun topStackFrame(error: Throwable): String? {
    val stackFrame = error.stackTrace.firstOrNull() ?: return null
    return "${stackFrame.className}.${stackFrame.methodName}:${stackFrame.lineNumber}"
}

private val rawBodyPattern: Regex = Regex(
    pattern = """(?i)\b((?:response\s+body|raw\s+body|raw\s+response)\s*[:=]\s*).*$"""
)
private val urlQueryPattern: Regex = Regex(
    pattern = """\b((?:https?|wss?)://[^\s?#]+)\?[^\s]+"""
)
private val queryParameterPattern: Regex = Regex(
    pattern = """(?i)\b(token|code|email|key|api[-_]?key|password|secret)=([^&\s]+)"""
)
private val authHeaderPattern: Regex = Regex(
    pattern = """(?i)\b(authorization|x-api-key|api[-_]?key|token|secret|password)\b\s*[:=]\s*[^,&\s]+"""
)
private val emailPattern: Regex = Regex(
    pattern = """(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b"""
)
private val jwtPattern: Regex = Regex(
    pattern = """\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"""
)
private val base64LikePattern: Regex = Regex(
    pattern = """\b[A-Za-z0-9+/]{80,}={0,2}\b"""
)
