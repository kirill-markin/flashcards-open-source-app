package com.flashcardsopensourceapp.data.local.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AiChatModelsTest {
    @Test
    fun buildAiChatWireMessagesIncludesImageAndFileContent() {
        val messages = listOf(
            AiChatMessage(
                messageId = "message-1",
                role = AiChatRole.USER,
                content = listOf(
                    AiChatContentPart.Image(
                        fileName = "photo.jpg",
                        mediaType = "image/jpeg",
                        base64Data = "abc"
                    ),
                    AiChatContentPart.File(
                        fileName = "notes.md",
                        mediaType = "text/markdown",
                        base64Data = "def"
                    ),
                    AiChatContentPart.Text(text = "Summarize these")
                ),
                timestampMillis = 1L,
                isError = false
            )
        )

        val wireMessages = buildAiChatWireMessages(messages = messages)

        assertEquals(1, wireMessages.size)
        assertTrue(wireMessages.single().content[0] is AiChatWireContentPart.Image)
        assertTrue(wireMessages.single().content[1] is AiChatWireContentPart.File)
        assertTrue(wireMessages.single().content[2] is AiChatWireContentPart.Text)
    }

    @Test
    fun supportedAttachmentExtensionAllowsMarkdownFiles() {
        requireSupportedAiChatAttachmentExtension(fileExtension = "md")
    }

    @Test(expected = IllegalArgumentException::class)
    fun unsupportedAttachmentExtensionFailsClearly() {
        requireSupportedAiChatAttachmentExtension(fileExtension = "exe")
    }

    @Test(expected = IllegalArgumentException::class)
    fun oversizedAttachmentFailsClearly() {
        requireAiChatAttachmentSize(byteCount = aiChatMaximumAttachmentBytes + 1)
    }
}
