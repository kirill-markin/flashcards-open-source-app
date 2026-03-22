package com.flashcardsopensourceapp.data.local.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CloudSupportTest {
    @Test
    fun makeOfficialCloudServiceConfigurationReturnsOfficialEndpoints() {
        val configuration = makeOfficialCloudServiceConfiguration()

        assertEquals(CloudServiceConfigurationMode.OFFICIAL, configuration.mode)
        assertEquals(null, configuration.customOrigin)
        assertEquals("https://api.flashcards-open-source-app.com/v1", configuration.apiBaseUrl)
        assertEquals("https://auth.flashcards-open-source-app.com", configuration.authBaseUrl)
    }

    @Test
    fun makeCustomCloudServiceConfigurationBuildsDerivedEndpoints() {
        val configuration = makeCustomCloudServiceConfiguration(customOrigin = "https://Example.com:8443/")

        assertEquals(CloudServiceConfigurationMode.CUSTOM, configuration.mode)
        assertEquals("https://example.com:8443", configuration.customOrigin)
        assertEquals("https://api.example.com:8443/v1", configuration.apiBaseUrl)
        assertEquals("https://auth.example.com:8443", configuration.authBaseUrl)
    }

    @Test
    fun normalizeCustomCloudOriginRejectsPaths() {
        try {
            normalizeCustomCloudOrigin(customOrigin = "https://example.com/custom")
        } catch (error: IllegalArgumentException) {
            assertEquals(
                "Custom server must not include a path: https://example.com/custom",
                error.message
            )
            return
        }

        throw AssertionError("Expected custom server path validation to fail.")
    }

    @Test
    fun shouldRefreshCloudIdTokenTurnsTrueInsideFiveMinuteWindow() {
        assertFalse(
            shouldRefreshCloudIdToken(
                idTokenExpiresAtMillis = 1_000_000L,
                nowMillis = 600_000L
            )
        )
        assertTrue(
            shouldRefreshCloudIdToken(
                idTokenExpiresAtMillis = 1_000_000L,
                nowMillis = 700_001L
            )
        )
    }

    @Test
    fun formatAndParseIsoTimestampRoundTrip() {
        val timestampMillis = 1_710_000_123_456L

        val formattedValue = formatIsoTimestamp(timestampMillis = timestampMillis)

        assertEquals(timestampMillis, parseIsoTimestamp(value = formattedValue))
    }
}
