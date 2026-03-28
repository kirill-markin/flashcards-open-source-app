package com.flashcardsopensourceapp.data.local.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class WorkspaceSchedulerSettingsSupportTest {
    @Test
    fun makeDefaultWorkspaceSchedulerSettingsUsesPinnedDefaults() {
        val settings = makeDefaultWorkspaceSchedulerSettings(
            workspaceId = "workspace-local",
            updatedAtMillis = 123L
        )

        assertEquals("workspace-local", settings.workspaceId)
        assertEquals("fsrs-6", settings.algorithm)
        assertEquals(0.90, settings.desiredRetention, 0.0)
        assertEquals(listOf(1, 10), settings.learningStepsMinutes)
        assertEquals(listOf(10), settings.relearningStepsMinutes)
        assertEquals(36_500, settings.maximumIntervalDays)
        assertTrue(settings.enableFuzz)
        assertEquals(123L, settings.updatedAtMillis)
    }

    @Test
    fun validateWorkspaceSchedulerSettingsInputRejectsNonIncreasingSteps() {
        assertFailsWithMessage(expectedMessage = "Learning steps must be strictly increasing.") {
            validateWorkspaceSchedulerSettingsInput(
                workspaceId = "workspace-local",
                desiredRetention = 0.9,
                learningStepsMinutes = listOf(10, 10),
                relearningStepsMinutes = listOf(10),
                maximumIntervalDays = 365,
                enableFuzz = true,
                updatedAtMillis = 1L
            )
        }
    }

    @Test
    fun schedulerStepJsonRoundTripPreservesValues() {
        val encoded = encodeSchedulerStepListJson(values = listOf(1, 10, 60))

        assertEquals("[1,10,60]", encoded)
        assertEquals(listOf(1, 10, 60), decodeSchedulerStepListJson(json = encoded))
    }

    @Test
    fun decodeSchedulerStepListJsonRejectsNonArrayPayloads() {
        assertFailsWithMessage(expectedMessage = "Scheduler steps JSON must be an array.") {
            decodeSchedulerStepListJson(json = """{"steps":[1,10]}""")
        }
    }

    private fun assertFailsWithMessage(expectedMessage: String, block: () -> Unit) {
        try {
            block()
            fail("Expected failure with message: $expectedMessage")
        } catch (error: IllegalArgumentException) {
            assertEquals(expectedMessage, error.message)
        }
    }
}
