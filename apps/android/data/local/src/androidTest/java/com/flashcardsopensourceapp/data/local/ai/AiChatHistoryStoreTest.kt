package com.flashcardsopensourceapp.data.local.ai

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatDraftState
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AiChatHistoryStoreTest {
    private lateinit var context: Context
    private lateinit var store: AiChatHistoryStore

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        context.deleteSharedPreferences("flashcards-ai-chat-history")
        store = AiChatHistoryStore(context = context)
    }

    @After
    fun tearDown() {
        context.deleteSharedPreferences("flashcards-ai-chat-history")
    }

    @Test
    fun loadDraftStateMigratesPendingSlotIntoResolvedSession() = runBlocking {
        val draftState = AiChatDraftState(
            draftMessage = "Draft note",
            pendingAttachments = listOf(
                AiChatAttachment.Card(
                    id = "attachment-1",
                    cardId = "card-1",
                    frontText = "Front",
                    backText = "Back",
                    tags = listOf("tag"),
                    effortLevel = EffortLevel.MEDIUM
                )
            )
        )

        store.saveDraftState(
            workspaceId = "workspace-1",
            sessionId = null,
            state = draftState
        )

        val loadedDraftState = store.loadDraftState(
            workspaceId = "workspace-1",
            sessionId = "session-1"
        )

        assertEquals(draftState, loadedDraftState)

        val preferences = context.getSharedPreferences("flashcards-ai-chat-history", Context.MODE_PRIVATE)
        assertFalse(preferences.contains(draftKey(workspaceId = "workspace-1", sessionId = "__pending__")))
        assertTrue(preferences.contains(draftKey(workspaceId = "workspace-1", sessionId = "session-1")))
    }

    @Test
    fun loadStateClearsCorruptedCardEffortLevelAndReturnsDefaultState() = runBlocking {
        val preferences = context.getSharedPreferences("flashcards-ai-chat-history", Context.MODE_PRIVATE)
        preferences.edit()
            .putString(
                historyKey(workspaceId = "workspace-1"),
                JSONObject()
                    .put(
                        "messages",
                        JSONArray().put(
                            JSONObject()
                                .put("messageId", "message-1")
                                .put("role", "USER")
                                .put(
                                    "content",
                                    JSONArray().put(
                                        JSONObject()
                                            .put("type", "card")
                                            .put("cardId", "card-1")
                                            .put("frontText", "Front")
                                            .put("backText", "Back")
                                            .put("tags", JSONArray().put("tag"))
                                            .put("effortLevel", "BROKEN")
                                    )
                                )
                                .put("timestampMillis", 1L)
                                .put("isError", false)
                                .put("isStopped", false)
                                .put("cursor", JSONObject.NULL)
                                .put("itemId", JSONObject.NULL)
                        )
                    )
                    .put("chatSessionId", "session-1")
                    .put("lastKnownChatConfig", JSONObject.NULL)
                    .toString()
            )
            .commit()

        val loadedState = store.loadState(workspaceId = "workspace-1")

        assertEquals(makeDefaultAiChatPersistedState(), loadedState)
        assertFalse(preferences.contains(historyKey(workspaceId = "workspace-1")))
    }

    private fun historyKey(workspaceId: String): String {
        return "ai-chat-history::$workspaceId"
    }

    private fun draftKey(workspaceId: String, sessionId: String): String {
        return "ai-chat-draft::$workspaceId::$sessionId"
    }
}
