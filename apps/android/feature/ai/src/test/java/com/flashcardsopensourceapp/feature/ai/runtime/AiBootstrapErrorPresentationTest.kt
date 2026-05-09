package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.makeOfficialCloudServiceConfiguration
import com.flashcardsopensourceapp.feature.ai.strings.testAiTextProvider
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AiBootstrapErrorPresentationTest {
    @Test
    fun ioExceptionUsesNetworkMessageAndTechnicalDetails() {
        val presentation = makeAiBootstrapErrorPresentation(
            error = IOException("timeout while connecting"),
            configuration = makeOfficialCloudServiceConfiguration(),
            textProvider = testAiTextProvider()
        )

        assertEquals(
            "We could not connect to AI. Check your connection and try again.",
            presentation.message
        )
        assertNotNull(presentation.technicalDetails)
        assertTrue(presentation.technicalDetails.orEmpty().contains("timeout while connecting"))
    }

    @Test
    fun remoteExceptionKeepsPrimaryMessageFriendlyAndMovesDiagnosticsToDetails() {
        val presentation = makeAiBootstrapErrorPresentation(
            error = AiChatRemoteException(
                message = "upstream failed with raw response",
                statusCode = 503,
                code = "LOCAL_CHAT_UNAVAILABLE",
                stage = "load_bootstrap",
                requestId = "request-123",
                responseBody = "{\"error\":\"raw\"}"
            ),
            configuration = makeOfficialCloudServiceConfiguration(),
            textProvider = testAiTextProvider()
        )
        val technicalDetails = presentation.technicalDetails.orEmpty()

        assertEquals(
            "AI is temporarily unavailable on the official server. Try again later.",
            presentation.message
        )
        assertFalse(presentation.message.contains("503"))
        assertFalse(presentation.message.contains("LOCAL_CHAT_UNAVAILABLE"))
        assertFalse(presentation.message.contains("load_bootstrap"))
        assertFalse(presentation.message.contains("raw"))
        assertTrue(technicalDetails.contains("statusCode: 503"))
        assertTrue(technicalDetails.contains("code: LOCAL_CHAT_UNAVAILABLE"))
        assertTrue(technicalDetails.contains("stage: load_bootstrap"))
        assertTrue(technicalDetails.contains("requestId: request-123"))
        assertFalse(technicalDetails.contains("message:"))
        assertFalse(technicalDetails.contains("upstream failed with raw response"))
        assertFalse(technicalDetails.contains("responseBody"))
        assertFalse(technicalDetails.contains("{\"error\":\"raw\"}"))
    }

    @Test
    fun contractMismatchUsesGenericMessageAndHidesRawPayloadFromDetails() {
        val presentation = makeAiBootstrapErrorPresentation(
            error = makeCloudContractMismatchException(
                message = "Cloud contract mismatch for chat bootstrap: payload={broken} body={\"secret\":\"value\"}"
            ),
            configuration = makeOfficialCloudServiceConfiguration(),
            textProvider = testAiTextProvider()
        )

        assertEquals("AI chat could not be loaded. Try again.", presentation.message)
        assertTrue(
            presentation.technicalDetails.orEmpty().contains(
                "type: com.flashcardsopensourceapp.data.local.cloud.CloudContractMismatchException"
            )
        )
        assertFalse(presentation.technicalDetails.orEmpty().contains("message:"))
        assertFalse(presentation.technicalDetails.orEmpty().contains("payload="))
        assertFalse(presentation.technicalDetails.orEmpty().contains("{broken}"))
        assertFalse(presentation.technicalDetails.orEmpty().contains("body="))
        assertFalse(presentation.technicalDetails.orEmpty().contains("{\"secret\":\"value\"}"))
        assertFalse(
            presentation.technicalDetails.orEmpty().contains(
                "Cloud contract mismatch for chat bootstrap"
            )
        )
    }

    @Test
    fun blockedCloudIdentityUsesFriendlyPrimaryMessageAndBlockedReasonInTechnicalDetails() {
        val presentation = makeAiBootstrapErrorPresentation(
            error = AiChatBootstrapBlockedException(
                message = "Cloud sync is blocked for this installation."
            ),
            configuration = makeOfficialCloudServiceConfiguration(),
            textProvider = testAiTextProvider()
        )

        assertEquals(
            "AI chat needs your cloud account status to be resolved before it can load.",
            presentation.message
        )
        assertFalse(presentation.message.contains("Cloud sync is blocked"))
        assertTrue(
            presentation.technicalDetails.orEmpty().contains(
                "Cloud sync is blocked for this installation."
            )
        )
    }

    private fun makeCloudContractMismatchException(message: String): Exception {
        val errorClass = Class.forName(
            "com.flashcardsopensourceapp.data.local.cloud.CloudContractMismatchException"
        )
        val constructor = errorClass.getDeclaredConstructor(String::class.java, Throwable::class.java)
        constructor.isAccessible = true
        return constructor.newInstance(message, null) as Exception
    }
}
