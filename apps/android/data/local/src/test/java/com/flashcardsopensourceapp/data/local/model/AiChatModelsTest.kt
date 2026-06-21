package com.flashcardsopensourceapp.data.local.model.ai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AiChatModelsTest {
    @Test
    fun canonicalAiChatAttachmentMediaTypeForExtensionNormalizesCsv() {
        assertEquals(
            "text/csv",
            canonicalAiChatAttachmentMediaTypeForExtension(fileExtension = "csv")
        )
    }

    @Test
    fun canonicalAiChatAttachmentMediaTypeForExtensionNormalizesXml() {
        assertEquals(
            "text/xml",
            canonicalAiChatAttachmentMediaTypeForExtension(fileExtension = "xml")
        )
    }

    @Test
    fun canonicalAiChatAttachmentMediaTypeForExtensionRejectsUnsupportedExtensions() {
        var thrownError: IllegalArgumentException? = null

        try {
            canonicalAiChatAttachmentMediaTypeForExtension(fileExtension = "rtf")
        } catch (error: IllegalArgumentException) {
            thrownError = error
        }

        assertEquals("Unsupported file type: .rtf", thrownError?.message)
    }

    @Test
    fun buildAiChatCardContextXmlMatchesBackendSerializer() {
        assertEquals(
            listOf(
                "<attached_card>",
                "<card_id>card-1</card_id>",
                "<front_text>",
                "Q &lt; 1 &quot;x&quot;",
                "</front_text>",
                "<back_text>",
                "A &amp; 2 &apos;y&apos; &gt; 0",
                "</back_text>",
                "<tags><tag>alpha</tag><tag>beta</tag></tags>",
                "</attached_card>"
            ).joinToString(separator = "\n"),
            buildAiChatCardContextXml(
                cardId = "card-1",
                frontText = "Q < 1 \"x\"",
                backText = "A & 2 'y' > 0",
                tags = listOf("alpha", "beta"),
            )
        )
    }

    @Test
    fun buildAiChatRequestContentDropsUnknownContent() {
        val requestContent = buildAiChatRequestContent(
            content = listOf(
                AiChatContentPart.Unknown(
                    originalType = "audio_transcript_v2",
                    summaryText = "Unsupported content",
                    rawPayloadJson = """{"type":"audio_transcript_v2"}"""
                ),
                AiChatContentPart.Text(text = "Hello")
            )
        )

        assertEquals(1, requestContent.size)
        assertTrue(requestContent.single() is AiChatWireContentPart.Text)
    }
}
