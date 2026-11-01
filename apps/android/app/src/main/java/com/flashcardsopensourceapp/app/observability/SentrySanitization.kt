package com.flashcardsopensourceapp.app.observability

private const val sentrySafeValueMaxLength: Int = 160
private const val sentryContextValueMaxLength: Int = 320
private const val sentryRedactedValue: String = "[redacted]"

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
        "throwableMessage=${sanitizeSentryContextValue(fieldName = "throwableMessage", value = error.message) ?: "null"} " +
        "topFrame=${sanitizeSentryLogValue(fieldName = "topFrame", value = topStackFrame(error = error))} " +
        "causeType=${sanitizeSentryLogValue(fieldName = "causeType", value = cause?.let { causeError -> causeError::class.java.name })} " +
        "causeMessage=${sanitizeSentryContextValue(fieldName = "causeMessage", value = cause?.message) ?: "null"} " +
        "stackTrace=${sanitizeSentryLogValue(fieldName = "stackTrace", value = compactStackTrace(error = error))}"
}

internal fun sanitizeSentryUrl(value: String?): String? {
    return sanitizeSentryString(fieldName = "url", value = value, maxLength = sentryContextValueMaxLength)
}

internal fun sanitizeSentryQueryString(value: String?): String? {
    return sanitizeSentryString(fieldName = "queryString", value = value, maxLength = sentryContextValueMaxLength)
}

internal fun isUnsafeSentryFieldName(fieldName: String): Boolean {
    val normalizedName: String = normalizeSentryFieldName(fieldName = fieldName)
    return normalizedName.contains("token") ||
        normalizedName.contains("authorization") ||
        normalizedName.contains("cookie") ||
        normalizedName.contains("password") ||
        normalizedName.contains("passcode") ||
        normalizedName.contains("secret") ||
        normalizedName.contains("apikey") ||
        normalizedName.contains("csrf") ||
        normalizedName.contains("xsrf") ||
        normalizedName.startsWith("otp") ||
        normalizedName.endsWith("otp")
}

/** Masks only secrets; everything else, emails and raw bodies included, stays readable. */
internal fun maskSentrySecrets(value: String): String {
    val withoutSecretAssignments = secretAssignmentPattern.replace(input = value, replacement = "\$1$sentryRedactedValue")
    val withoutCodeOrKeyParameters = codeOrKeyParameterPattern.replace(
        input = withoutSecretAssignments,
        replacement = "\$1$sentryRedactedValue"
    )
    val withoutJwt = jwtPattern.replace(input = withoutCodeOrKeyParameters, replacement = "[redacted-token]")
    val withoutOpenAiKeys = openAiKeyPattern.replace(input = withoutJwt, replacement = "[redacted-api-key]")
    return base64LikePattern.replace(input = withoutOpenAiKeys, replacement = "[redacted-base64]")
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
    val trimmedValue = maskSentrySecrets(value = withoutLineBreaks).trim()

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

private fun topStackFrame(error: Throwable): String? {
    val stackFrame = error.stackTrace.firstOrNull() ?: return null
    return "${stackFrame.className}.${stackFrame.methodName}:${stackFrame.lineNumber}"
}

// The value stops at a separator, so an unquoted multi-word secret is only partly masked.
// The bounded name prefix keeps matching linear on long base64url runs.
private val secretAssignmentPattern: Regex = Regex(
    pattern = """(?i)(\b[a-z0-9_-]{0,40}(?:token|secret|password|passcode|api[-_]?key|otp|csrf|xsrf|authorization|cookie)\b["']?\s*[:=]\s*)""" +
        """(?:"[^"]*"|'[^']*'|(?:(?:bearer|basic|guest|live)\s+)?[^,;&\s"'#]+)"""
)
// Bare `code` and `key` count as secrets only as query parameters (OTP and OAuth codes, API keys),
// so free text such as `failed code=E42` stays readable.
private val codeOrKeyParameterPattern: Regex = Regex(
    pattern = """(?i)(?:^|(?<=[?&#]))((?:code|key)=)[^&\s#]+"""
)
private val jwtPattern: Regex = Regex(
    pattern = """\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"""
)
private val openAiKeyPattern: Regex = Regex(
    pattern = """\bsk-[A-Za-z0-9_-]{20,}"""
)
private val base64LikePattern: Regex = Regex(
    pattern = """\b[A-Za-z0-9+/]{80,}={0,2}\b"""
)
