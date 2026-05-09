package com.flashcardsopensourceapp.data.local.ai

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatDraftState
import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.AiChatRole
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
    fun saveDraftStateStoresOnlyResolvedSessionIds() = runBlocking {
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
            sessionId = "session-1",
            state = draftState
        )

        val loadedDraftState = store.loadDraftState(
            workspaceId = "workspace-1",
            sessionId = "session-1"
        )

        assertEquals(draftState, loadedDraftState)

        val preferences = context.getSharedPreferences("flashcards-ai-chat-history", Context.MODE_PRIVATE)
        assertTrue(preferences.contains(draftKey(workspaceId = "workspace-1", sessionId = "session-1")))
    }

    @Test
    fun loadDraftStateReturnsDefaultWhenSessionIdIsMissing() = runBlocking {
        val loadedDraftState = store.loadDraftState(
            workspaceId = "workspace-1",
            sessionId = null
        )

        assertEquals(AiChatDraftState(draftMessage = "", pendingAttachments = emptyList()), loadedDraftState)
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

    @Test
    fun saveAndLoadStatePreservesUnknownContent() = runBlocking {
        val state = AiChatPersistedState(
            messages = listOf(
                AiChatMessage(
                    messageId = "message-1",
                    role = AiChatRole.ASSISTANT,
                    content = listOf(
                        AiChatContentPart.Unknown(
                            originalType = "audio_transcript_v2",
                            summaryText = "Unsupported content",
                            rawPayloadJson = """{"type":"audio_transcript_v2"}"""
                        )
                    ),
                    timestampMillis = 1L,
                    isError = false,
                    isStopped = false,
                    cursor = "cursor-1",
                    itemId = "item-1"
                )
            ),
            chatSessionId = "session-1",
            lastKnownChatConfig = null,
            pendingToolRunPostSync = true,
            requiresRemoteSessionProvisioning = true
        )

        store.saveState(workspaceId = "workspace-1", state = state)

        val loadedState = store.loadState(workspaceId = "workspace-1")
        assertEquals(state, loadedState)
    }

    @Test
    fun loadStateDefaultsPendingToolRunPostSyncToFalseWhenMissing() = runBlocking {
        val preferences = context.getSharedPreferences("flashcards-ai-chat-history", Context.MODE_PRIVATE)
        preferences.edit()
            .putString(
                historyKey(workspaceId = "workspace-1"),
                JSONObject()
                    .put("messages", JSONArray())
                    .put("chatSessionId", "session-1")
                    .put("lastKnownChatConfig", JSONObject.NULL)
                    .toString()
            )
            .commit()

        val loadedState = store.loadState(workspaceId = "workspace-1")

        assertFalse(loadedState.pendingToolRunPostSync)
        assertEquals("session-1", loadedState.chatSessionId)
    }

    @Test
    fun saveAndLoadDraftPreservesUnknownAttachment() = runBlocking {
        val draftState = AiChatDraftState(
            draftMessage = "",
            pendingAttachments = listOf(
                AiChatAttachment.Unknown(
                    id = "attachment-unknown",
                    originalType = "voice_note_v2",
                    summaryText = "Unsupported attachment",
                    rawPayloadJson = """{"type":"voice_note_v2"}"""
                )
            )
        )

        store.saveDraftState(
            workspaceId = "workspace-1",
            sessionId = "session-1",
            state = draftState
        )

        val loadedDraftState = store.loadDraftState(
            workspaceId = "workspace-1",
            sessionId = "session-1"
        )

        assertEquals(draftState, loadedDraftState)
    }

    private fun historyKey(workspaceId: String): String {
        return "ai-chat-history::$workspaceId"
    }

    private fun draftKey(workspaceId: String, sessionId: String): String {
        return "ai-chat-draft::$workspaceId::$sessionId"
    }
}
