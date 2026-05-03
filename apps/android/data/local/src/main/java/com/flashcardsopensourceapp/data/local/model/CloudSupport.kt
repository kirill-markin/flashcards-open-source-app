package com.flashcardsopensourceapp.data.local.model

import java.net.URI
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

private const val flashcardsOfficialApiBaseUrl: String = "https://api.flashcards-open-source-app.com/v1"
private const val flashcardsOfficialAuthBaseUrl: String = "https://auth.flashcards-open-source-app.com"
private val canonicalIsoTimestampFormatter: DateTimeFormatter = DateTimeFormatter
    .ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    .withZone(ZoneOffset.UTC)

fun makeOfficialCloudServiceConfiguration(): CloudServiceConfiguration {
    return CloudServiceConfiguration(
        mode = CloudServiceConfigurationMode.OFFICIAL,
        customOrigin = null,
        apiBaseUrl = flashcardsOfficialApiBaseUrl,
        authBaseUrl = flashcardsOfficialAuthBaseUrl
    )
}

fun makeCustomCloudServiceConfiguration(customOrigin: String): CloudServiceConfiguration {
    val normalizedOrigin = normalizeCustomCloudOrigin(customOrigin = customOrigin)
    val parsedOrigin = URI(normalizedOrigin)
    val host = requireNotNull(parsedOrigin.host) {
        "Custom server must include a host: $customOrigin"
    }
    val portSuffix = if (parsedOrigin.port == -1) {
        ""
    } else {
        ":${parsedOrigin.port}"
    }

    return CloudServiceConfiguration(
        mode = CloudServiceConfigurationMode.CUSTOM,
        customOrigin = normalizedOrigin,
        apiBaseUrl = "https://api.$host$portSuffix/v1",
        authBaseUrl = "https://auth.$host$portSuffix"
    )
}

fun normalizeCustomCloudOrigin(customOrigin: String): String {
    val trimmedOrigin = customOrigin.trim()
    require(trimmedOrigin.isNotEmpty()) {
        "Custom server must not be empty."
    }

    val parsedOrigin = try {
        URI(trimmedOrigin)
    } catch (error: Exception) {
        throw IllegalArgumentException("Custom server must be a valid HTTPS URL: $customOrigin", error)
    }

    require(parsedOrigin.scheme?.lowercase(Locale.US) == "https") {
        "Custom server must use HTTPS: $customOrigin"
    }
    require(parsedOrigin.host.isNullOrBlank().not()) {
        "Custom server must include a host: $customOrigin"
    }
    require(parsedOrigin.userInfo == null) {
        "Custom server must not include credentials: $customOrigin"
    }
    require(parsedOrigin.query == null && parsedOrigin.fragment == null) {
        "Custom server must not include query or fragment: $customOrigin"
    }
    require(parsedOrigin.path.isNullOrBlank() || parsedOrigin.path == "/") {
        "Custom server must not include a path: $customOrigin"
    }

    val normalizedPort = if (parsedOrigin.port == -1) {
        ""
    } else {
        ":${parsedOrigin.port}"
    }

    return "https://${parsedOrigin.host.lowercase(Locale.US)}$normalizedPort"
}

fun shouldRefreshCloudIdToken(idTokenExpiresAtMillis: Long, nowMillis: Long): Boolean {
    return idTokenExpiresAtMillis - nowMillis <= 300_000L
}

fun makeIdTokenExpiryTimestampMillis(nowMillis: Long, expiresInSeconds: Int): Long {
    return nowMillis + (expiresInSeconds * 1_000L)
}

fun parseIsoTimestamp(value: String): Long {
    return Instant.parse(value).toEpochMilli()
}

fun formatIsoTimestamp(timestampMillis: Long): String {
    return canonicalIsoTimestampFormatter.format(Instant.ofEpochMilli(timestampMillis))
}
