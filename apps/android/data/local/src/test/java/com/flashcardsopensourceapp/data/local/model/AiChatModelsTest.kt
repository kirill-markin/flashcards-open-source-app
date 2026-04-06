package com.flashcardsopensourceapp.data.local.model

import org.junit.Assert.assertEquals
import org.junit.Test

class AiChatModelsTest {
    @Test
    fun buildAiChatCardContextXmlMatchesBackendSerializer() {
        assertEquals(
            listOf(
                "<attached_card>",
                "<card_id>card-1</card_id>",
                "<effort_level>long</effort_level>",
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
                effortLevel = EffortLevel.LONG
            )
        )
    }
}
