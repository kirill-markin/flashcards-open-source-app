package com.flashcardsopensourceapp.data.local.model

import org.junit.Assert.assertEquals
import org.junit.Test

class CloudSupportTest {
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
