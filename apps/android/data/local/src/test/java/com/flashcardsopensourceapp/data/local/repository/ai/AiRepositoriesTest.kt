package com.flashcardsopensourceapp.data.local.repository.ai

import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AiRepositoriesTest {
    @Test
    fun resolveAiChatSessionIdOrNullTrimsPersistedSessionId() {
        val persistedState = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "  session-1  "
        )

        assertEquals("session-1", resolveAiChatSessionIdOrNull(persistedState = persistedState))
    }

    @Test
    fun resolveAiChatSessionIdOrNullReturnsNullForBlankPersistedSessionId() {
        val persistedState = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "   "
        )

        assertNull(resolveAiChatSessionIdOrNull(persistedState = persistedState))
    }

    @Test(expected = IllegalArgumentException::class)
    fun requireExplicitAiChatSessionIdForRunRejectsBlankPersistedSessionId() {
        requireExplicitAiChatSessionIdForRun(
            state = makeDefaultAiChatPersistedState()
        )
    }
}
