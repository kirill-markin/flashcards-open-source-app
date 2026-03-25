package com.flashcardsopensourceapp.data.local.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AiChatModelsTest {
    @Test
    fun buildAiChatRequestContentIncludesImageAndFileContent() {
        val content = listOf(
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
        )

        val requestContent = buildAiChatRequestContent(content = content)

        assertEquals(3, requestContent.size)
        assertTrue(requestContent[0] is AiChatWireContentPart.Image)
        assertTrue(requestContent[1] is AiChatWireContentPart.File)
        assertTrue(requestContent[2] is AiChatWireContentPart.Text)
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
