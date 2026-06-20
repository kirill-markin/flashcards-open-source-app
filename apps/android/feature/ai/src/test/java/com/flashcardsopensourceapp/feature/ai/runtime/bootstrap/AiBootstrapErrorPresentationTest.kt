package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.ai.remote.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.cloud.makeOfficialCloudServiceConfiguration
import com.flashcardsopensourceapp.feature.ai.runtime.coordinators.bootstrap.AiChatBootstrapBlockedException
import com.flashcardsopensourceapp.feature.ai.runtime.errors.AiErrorSurface
import com.flashcardsopensourceapp.feature.ai.runtime.observability.AiChatFailureIssueDisposition
import com.flashcardsopensourceapp.feature.ai.runtime.observability.aiChatFailureIssueDisposition
import com.flashcardsopensourceapp.feature.ai.runtime.observability.makeAiBootstrapErrorPresentation
import com.flashcardsopensourceapp.feature.ai.runtime.observability.makeAiUserFacingErrorPresentation
import com.flashcardsopensourceapp.feature.ai.strings.testAiTextProvider
import java.net.ProtocolException
import java.net.SocketTimeoutException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AiBootstrapErrorPresentationTest {
    @Test
    fun transientIoExceptionUsesNetworkMessageAndHidesTechnicalDetails() {
        val presentation = makeAiBootstrapErrorPresentation(
            error = SocketTimeoutException("timeout"),
            configuration = makeOfficialCloudServiceConfiguration(),
            textProvider = testAiTextProvider()
        )

        assertEquals(
            "We could not connect to AI. Check your connection and try again.",
            presentation.message
        )
        assertNull(presentation.technicalDetails)
    }

    @Test
    fun unexpectedIoExceptionUsesNetworkMessageAndTechnicalDetails() {
        val presentation = makeAiBootstrapErrorPresentation(
            error = ProtocolException("bad response contract"),
            configuration = makeOfficialCloudServiceConfiguration(),
            textProvider = testAiTextProvider()
        )

        assertEquals(
            "We could not connect to AI. Check your connection and try again.",
            presentation.message
        )
        assertNotNull(presentation.technicalDetails)
        assertTrue(presentation.technicalDetails.orEmpty().contains("bad response contract"))
    }

    @Test
    fun transientIoUserFacingPresentationHidesTechnicalError() {
        val presentation = makeAiUserFacingErrorPresentation(
            error = SocketTimeoutException("timeout"),
            surface = AiErrorSurface.CHAT,
            configuration = makeOfficialCloudServiceConfiguration(),
            textProvider = testAiTextProvider()
        )

        assertEquals("AI request failed.", presentation.message)
        assertNull(presentation.technicalError)
    }

    @Test
    fun unexpectedIoUserFacingPresentationKeepsTechnicalError() {
        val error = ProtocolException("bad response contract")
        val presentation = makeAiUserFacingErrorPresentation(
            error = error,
            surface = AiErrorSurface.CHAT,
            configuration = makeOfficialCloudServiceConfiguration(),
            textProvider = testAiTextProvider()
        )

        assertEquals("AI request failed.", presentation.message)
        assertEquals(error, presentation.technicalError)
    }

    @Test
    fun expectedRemoteExceptionKeepsPrimaryMessageFriendlyAndHidesTechnicalDetails() {
        val presentation = makeAiBootstrapErrorPresentation(
            error = AiChatRemoteException(
                message = "upstream failed with raw response",
                statusCode = 503,
                code = "LOCAL_CHAT_UNAVAILABLE",
                stage = "load_bootstrap",
                requestId = "request-123",
                responseBody = "{\"error\":\"raw\"}",
                androidObservationAlreadyCaptured = false
            ),
            configuration = makeOfficialCloudServiceConfiguration(),
            textProvider = testAiTextProvider()
        )

        assertEquals(
            "AI is temporarily unavailable on the official server. Try again later.",
            presentation.message
        )
        assertFalse(presentation.message.contains("503"))
        assertFalse(presentation.message.contains("LOCAL_CHAT_UNAVAILABLE"))
        assertFalse(presentation.message.contains("load_bootstrap"))
        assertFalse(presentation.message.contains("raw"))
        assertNull(presentation.technicalDetails)
    }

    @Test
    fun expectedProviderRemoteExceptionHidesTechnicalDetails() {
        val presentation = makeAiBootstrapErrorPresentation(
            error = AiChatRemoteException(
                message = "provider auth failed with raw response",
                statusCode = 503,
                code = "LOCAL_CHAT_PROVIDER_AUTH_FAILED",
                stage = "load_bootstrap",
                requestId = "request-456",
                responseBody = "{\"error\":\"raw\"}",
                androidObservationAlreadyCaptured = false
            ),
            configuration = makeOfficialCloudServiceConfiguration(),
            textProvider = testAiTextProvider()
        )

        assertEquals(
            "AI is temporarily unavailable on the official server. Try again later.",
            presentation.message
        )
        assertFalse(presentation.message.contains("503"))
        assertFalse(presentation.message.contains("LOCAL_CHAT_PROVIDER_AUTH_FAILED"))
        assertFalse(presentation.message.contains("provider auth failed"))
        assertNull(presentation.technicalDetails)
    }

    @Test
    fun expectedRemoteProviderAndTranscriptionErrorsHaveNoIssueDisposition() {
        listOf(
            "LOCAL_CHAT_UNAVAILABLE",
            "LOCAL_CHAT_PROVIDER_AUTH_FAILED",
            "CHAT_TRANSCRIPTION_NOT_CONFIGURED",
            "CHAT_TRANSCRIPTION_PROVIDER_AUTH_FAILED",
            "CHAT_TRANSCRIPTION_UNAVAILABLE"
        ).forEach { code ->
            val error = AiChatRemoteException(
                message = "expected provider failure",
                statusCode = 503,
                code = code,
                stage = "load_bootstrap",
                requestId = "request-$code",
                responseBody = "{\"error\":\"raw\"}",
                androidObservationAlreadyCaptured = false
            )

            assertEquals(
                AiChatFailureIssueDisposition.NONE,
                aiChatFailureIssueDisposition(error = error)
            )
        }
    }

    @Test
    fun unexpectedRemoteExceptionKeepsPrimaryMessageFriendlyAndMovesDiagnosticsToDetails() {
        val presentation = makeAiBootstrapErrorPresentation(
            error = AiChatRemoteException(
                message = "upstream failed with raw response",
                statusCode = 503,
                code = "AI_PROVIDER_EXPLODED",
                stage = "load_bootstrap",
                requestId = "request-123",
                responseBody = "{\"error\":\"raw\"}",
                androidObservationAlreadyCaptured = false
            ),
            configuration = makeOfficialCloudServiceConfiguration(),
            textProvider = testAiTextProvider()
        )
        val technicalDetails = presentation.technicalDetails.orEmpty()

        assertEquals("AI chat could not be loaded. Try again.", presentation.message)
        assertFalse(presentation.message.contains("503"))
        assertFalse(presentation.message.contains("AI_PROVIDER_EXPLODED"))
        assertFalse(presentation.message.contains("load_bootstrap"))
        assertFalse(presentation.message.contains("raw"))
        assertTrue(technicalDetails.contains("statusCode: 503"))
        assertTrue(technicalDetails.contains("code: AI_PROVIDER_EXPLODED"))
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
                "type: com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException"
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
    fun blockedCloudIdentityUsesFriendlyPrimaryMessageAndHidesTechnicalDetails() {
        val error = AiChatBootstrapBlockedException()
        val presentation = makeAiBootstrapErrorPresentation(
            error = error,
            configuration = makeOfficialCloudServiceConfiguration(),
            textProvider = testAiTextProvider()
        )

        assertEquals(
            "AI chat needs your cloud account status to be resolved before it can load.",
            presentation.message
        )
        assertFalse(presentation.message.contains("Cloud sync is blocked"))
        assertNull(presentation.technicalDetails)
        assertEquals(
            AiChatFailureIssueDisposition.NONE,
            aiChatFailureIssueDisposition(error = error)
        )
    }

    private fun makeCloudContractMismatchException(message: String): Exception {
        val errorClass = Class.forName(
            "com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException"
        )
        val constructor = errorClass.getDeclaredConstructor(String::class.java, Throwable::class.java)
        constructor.isAccessible = true
        return constructor.newInstance(message, null) as Exception
    }
}
