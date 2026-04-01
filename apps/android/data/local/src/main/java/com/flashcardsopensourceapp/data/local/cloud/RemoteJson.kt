package com.flashcardsopensourceapp.data.local.cloud

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

internal val strictRemoteJson: Json = Json {
    ignoreUnknownKeys = true
    isLenient = false
    coerceInputValues = false
    explicitNulls = true
}

internal fun buildRemoteContractMismatch(
    context: String,
    rawBody: String,
    error: Throwable
): CloudContractMismatchException {
    val snippet = rawBody.trim().replace(oldValue = "\n", newValue = "\\n").take(n = 240)
    return CloudContractMismatchException(
        "Cloud contract mismatch for $context: ${describeRemoteDecodeError(error)}. payload=$snippet",
        error
    )
}

private fun describeRemoteDecodeError(error: Throwable): String {
    return when (error) {
        is SerializationException -> error.message ?: "serialization failed"
        else -> error.message ?: error::class.java.simpleName
    }
}
