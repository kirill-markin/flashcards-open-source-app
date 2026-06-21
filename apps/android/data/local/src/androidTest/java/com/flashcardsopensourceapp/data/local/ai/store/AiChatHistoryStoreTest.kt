package com.flashcardsopensourceapp.data.local.ai.store

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.model.ai.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.ai.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.ai.AiChatDraftState
import com.flashcardsopensourceapp.data.local.model.ai.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.ai.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.ai.AiChatRole
import com.flashcardsopensourceapp.data.local.model.ai.defaultAiChatServerConfig
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
    fun loadStatePreservesLegacyCardEffortLevelAsTag() = runBlocking {
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
                                            .put("effortLevel", "MEDIUM")
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

        assertEquals(1, loadedState.messages.size)
        assertEquals(
            AiChatContentPart.Card(
                cardId = "card-1",
                frontText = "Front",
                backText = "Back",
                tags = listOf("tag", "medium")
            ),
            loadedState.messages.first().content.first()
        )
        assertTrue(preferences.contains(historyKey(workspaceId = "workspace-1")))
    }

    @Test
    fun loadDraftStatePreservesLegacyCardEffortLevelAsTag() = runBlocking {
        val preferences = context.getSharedPreferences("flashcards-ai-chat-history", Context.MODE_PRIVATE)
        preferences.edit()
            .putString(
                draftKey(workspaceId = "workspace-1", sessionId = "session-1"),
                JSONObject()
                    .put("draftMessage", "Draft")
                    .put(
                        "pendingAttachments",
                        JSONArray().put(
                            JSONObject()
                                .put("type", "card")
                                .put("id", "attachment-1")
                                .put("cardId", "card-1")
                                .put("frontText", "Front")
                                .put("backText", "Back")
                                .put("tags", JSONArray().put("tag"))
                                .put("effortLevel", "LONG")
                        )
                    )
                    .toString()
            )
            .commit()

        val loadedDraftState = store.loadDraftState(
            workspaceId = "workspace-1",
            sessionId = "session-1"
        )

        assertEquals(
            AiChatDraftState(
                draftMessage = "Draft",
                pendingAttachments = listOf(
                    AiChatAttachment.Card(
                        id = "attachment-1",
                        cardId = "card-1",
                        frontText = "Front",
                        backText = "Back",
                        tags = listOf("tag", "long")
                    )
                )
            ),
            loadedDraftState
        )
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
            composerSuggestions = emptyList(),
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
    fun saveStatePersistsOnlyChatFeatureConfig() = runBlocking {
        val state = AiChatPersistedState(
            messages = emptyList(),
            composerSuggestions = emptyList(),
            chatSessionId = "session-1",
            lastKnownChatConfig = defaultAiChatServerConfig,
            pendingToolRunPostSync = false,
            requiresRemoteSessionProvisioning = false
        )

        store.saveState(workspaceId = "workspace-1", state = state)

        val preferences = context.getSharedPreferences("flashcards-ai-chat-history", Context.MODE_PRIVATE)
        val savedState = JSONObject(requireNotNull(preferences.getString(historyKey(workspaceId = "workspace-1"), null)))
        val savedConfig = savedState.getJSONObject("lastKnownChatConfig")
        val savedFeatures = savedConfig.getJSONObject("features")

        assertFalse(savedConfig.has("provider"))
        assertFalse(savedConfig.has("model"))
        assertFalse(savedConfig.has("reasoning"))
        assertTrue(savedFeatures.getBoolean("dictationEnabled"))
        assertTrue(savedFeatures.getBoolean("attachmentsEnabled"))
        assertEquals(state, store.loadState(workspaceId = "workspace-1"))
    }

    @Test
    fun loadStateReadsLegacyChatConfigFeatures() = runBlocking {
        val preferences = context.getSharedPreferences("flashcards-ai-chat-history", Context.MODE_PRIVATE)
        preferences.edit()
            .putString(
                historyKey(workspaceId = "workspace-1"),
                JSONObject()
                    .put("messages", JSONArray())
                    .put("chatSessionId", "session-1")
                    .put(
                        "lastKnownChatConfig",
                        JSONObject()
                            .put("provider", JSONObject().put("id", "legacy-provider").put("label", "Legacy provider"))
                            .put(
                                "model",
                                JSONObject()
                                    .put("id", "legacy-model")
                                    .put("label", "Legacy model")
                                    .put("badgeLabel", "Legacy model · legacy reasoning")
                            )
                            .put("reasoning", JSONObject().put("effort", "legacy").put("label", "Legacy reasoning"))
                            .put(
                                "features",
                                JSONObject()
                                    .put("dictationEnabled", false)
                                    .put("attachmentsEnabled", false)
                            )
                    )
                    .toString()
            )
            .commit()

        val loadedConfig = requireNotNull(store.loadState(workspaceId = "workspace-1").lastKnownChatConfig)

        assertFalse(loadedConfig.features.dictationEnabled)
        assertFalse(loadedConfig.features.attachmentsEnabled)
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
