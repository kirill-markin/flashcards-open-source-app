package com.flashcardsopensourceapp.data.local.model.cloud

import org.junit.Assert.assertEquals
import org.junit.Test

class CloudSupportTest {
    @Test
    fun makeCustomCloudServiceConfigurationCanonicalizesApiHostToRootOrigin() {
        val configuration = makeCustomCloudServiceConfiguration(
            customOrigin = " https://api.Example.COM:8443 "
        )

        assertEquals("https://example.com:8443", configuration.customOrigin)
        assertEquals("https://api.example.com:8443/v1", configuration.apiBaseUrl)
        assertEquals("https://auth.example.com:8443", configuration.authBaseUrl)
    }

    @Test
    fun makeCustomCloudServiceConfigurationCanonicalizesAuthHostToRootOrigin() {
        val configuration = makeCustomCloudServiceConfiguration(
            customOrigin = "https://auth.example.com"
        )

        assertEquals("https://example.com", configuration.customOrigin)
        assertEquals("https://api.example.com/v1", configuration.apiBaseUrl)
        assertEquals("https://auth.example.com", configuration.authBaseUrl)
    }

    @Test
    fun makeCustomCloudServiceConfigurationKeepsRootOrigin() {
        val configuration = makeCustomCloudServiceConfiguration(
            customOrigin = "https://Example.COM"
        )

        assertEquals("https://example.com", configuration.customOrigin)
        assertEquals("https://api.example.com/v1", configuration.apiBaseUrl)
        assertEquals("https://auth.example.com", configuration.authBaseUrl)
    }

    @Test
    fun formatIsoTimestampEmitsCanonicalUtcMilliseconds() {
        assertEquals(
            "2026-03-10T12:00:00.000Z",
            formatIsoTimestamp(timestampMillis = 1773144000000L)
        )
        assertEquals(
            "2026-03-10T12:00:00.100Z",
            formatIsoTimestamp(timestampMillis = 1773144000100L)
        )
    }
}
