package com.flashcardsopensourceapp.data.local.ai

import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AiChatConversationDecodingTest {
    @Test
    fun decodeAcceptedEnvelopeIncludesActiveRun() {
        val response = decodeAiChatStartRunResponse(
            payload = """
            {
              "accepted": true,
              "sessionId": "session-1",
              "conversationScopeId": "session-1",
              "conversation": {
                "updatedAt": 100,
                "mainContentInvalidationVersion": 200,
                "messages": [],
                "hasOlder": false,
                "oldestCursor": null
              },
              "composerSuggestions": [],
              "chatConfig": {
                "provider": { "id": "openai", "label": "OpenAI" },
                "model": { "id": "gpt-5.4", "label": "GPT-5.4", "badgeLabel": "GPT-5.4 · Medium" },
                "reasoning": { "effort": "medium", "label": "Medium" },
                "features": {
                  "modelPickerEnabled": false,
                  "dictationEnabled": true,
                  "attachmentsEnabled": true
                },
                "liveUrl": "http://localhost/live"
              },
              "activeRun": {
                "runId": "run-1",
                "status": "running",
                "live": {
                  "cursor": "9",
                  "stream": {
                    "url": "http://localhost/live",
                    "authorization": "Live token-1",
                    "expiresAt": 123
                  }
                },
                "lastHeartbeatAt": 456
              },
              "deduplicated": false
            }
            """.trimIndent()
        )

        assertTrue(response.accepted)
        assertEquals("session-1", response.conversationScopeId)
        assertEquals("run-1", response.activeRun?.runId)
        assertEquals("9", response.activeRun?.live?.cursor)
        assertEquals(false, response.deduplicated)
    }

    @Test
    fun decodeAcceptedEnvelopeWithoutComposerSuggestionsDefaultsToEmptyList() {
        val response = decodeAiChatStartRunResponse(
            payload = """
            {
              "accepted": true,
              "sessionId": "session-1",
              "conversationScopeId": "session-1",
              "conversation": {
                "updatedAt": 100,
                "mainContentInvalidationVersion": 200,
                "messages": [],
                "hasOlder": false,
                "oldestCursor": null
              },
              "chatConfig": {
                "provider": { "id": "openai", "label": "OpenAI" },
                "model": { "id": "gpt-5.4", "label": "GPT-5.4", "badgeLabel": "GPT-5.4 · Medium" },
                "reasoning": { "effort": "medium", "label": "Medium" },
                "features": {
                  "modelPickerEnabled": false,
                  "dictationEnabled": true,
                  "attachmentsEnabled": true
                },
                "liveUrl": null
              },
              "activeRun": null
            }
            """.trimIndent()
        )

        assertEquals(0, response.composerSuggestions.size)
    }

    @Test
    fun decodeSnapshotEnvelopeWithoutActiveRun() {
        val snapshot = decodeAiChatSessionSnapshot(
            payload = """
            {
              "sessionId": "session-1",
              "conversationScopeId": "session-1",
              "conversation": {
                "updatedAt": 100,
                "mainContentInvalidationVersion": 200,
                "messages": [],
                "hasOlder": false,
                "oldestCursor": null
              },
              "composerSuggestions": [],
              "chatConfig": {
                "provider": { "id": "openai", "label": "OpenAI" },
                "model": { "id": "gpt-5.4", "label": "GPT-5.4", "badgeLabel": "GPT-5.4 · Medium" },
                "reasoning": { "effort": "medium", "label": "Medium" },
                "features": {
                  "modelPickerEnabled": false,
                  "dictationEnabled": true,
                  "attachmentsEnabled": true
                },
                "liveUrl": null
              },
              "activeRun": null
            }
            """.trimIndent()
        )

        assertEquals("session-1", snapshot.sessionId)
        assertEquals("session-1", snapshot.conversationScopeId)
        assertNull(snapshot.activeRun)
        assertEquals(0, snapshot.conversation.messages.size)
    }

    @Test
    fun decodeSnapshotEnvelopeWithUnknownContentFallsBackToUnknownPart() {
        val snapshot = decodeAiChatSessionSnapshot(
            payload = """
            {
              "sessionId": "session-1",
              "conversationScopeId": "session-1",
              "conversation": {
                "updatedAt": 100,
                "mainContentInvalidationVersion": 200,
                "messages": [
                  {
                    "role": "assistant",
                    "content": [
                      {
                        "type": "audio_transcript_v2",
                        "text": "future"
                      }
                    ],
                    "timestamp": 123,
                    "isError": false,
                    "isStopped": false,
                    "cursor": "cur-1",
                    "itemId": "item-1"
                  }
                ],
                "hasOlder": false,
                "oldestCursor": null
              },
              "composerSuggestions": [],
              "chatConfig": {
                "provider": { "id": "openai", "label": "OpenAI" },
                "model": { "id": "gpt-5.4", "label": "GPT-5.4", "badgeLabel": "GPT-5.4 · Medium" },
                "reasoning": { "effort": "medium", "label": "Medium" },
                "features": {
                  "modelPickerEnabled": false,
                  "dictationEnabled": true,
                  "attachmentsEnabled": true
                },
                "liveUrl": null
              },
              "activeRun": null
            }
            """.trimIndent()
        )

        val unknownPart = snapshot.conversation.messages.single().content.single() as AiChatContentPart.Unknown
        assertEquals("audio_transcript_v2", unknownPart.originalType)
        assertEquals("Unsupported content", unknownPart.summaryText)
        assertTrue(unknownPart.rawPayloadJson?.contains("audio_transcript_v2") == true)
    }

    @Test
    fun decodeSnapshotEnvelopeWithoutComposerSuggestionsDefaultsToEmptyList() {
        val snapshot = decodeAiChatSessionSnapshot(
            payload = """
            {
              "sessionId": "session-1",
              "conversationScopeId": "session-1",
              "conversation": {
                "updatedAt": 100,
                "mainContentInvalidationVersion": 200,
                "messages": [],
                "hasOlder": false,
                "oldestCursor": null
              },
              "chatConfig": {
                "provider": { "id": "openai", "label": "OpenAI" },
                "model": { "id": "gpt-5.4", "label": "GPT-5.4", "badgeLabel": "GPT-5.4 · Medium" },
                "reasoning": { "effort": "medium", "label": "Medium" },
                "features": {
                  "modelPickerEnabled": false,
                  "dictationEnabled": true,
                  "attachmentsEnabled": true
                },
                "liveUrl": null
              },
              "activeRun": null
            }
            """.trimIndent()
        )

        assertEquals(0, snapshot.composerSuggestions.size)
    }

    @Test
    fun decodeBootstrapEnvelopeWithoutComposerSuggestionsDefaultsToEmptyList() {
        val response = decodeAiChatBootstrapResponse(
            payload = """
            {
              "sessionId": "session-1",
              "conversationScopeId": "session-1",
              "conversation": {
                "updatedAt": 100,
                "mainContentInvalidationVersion": 200,
                "messages": [],
                "hasOlder": false,
                "oldestCursor": null
              },
              "chatConfig": {
                "provider": { "id": "openai", "label": "OpenAI" },
                "model": { "id": "gpt-5.4", "label": "GPT-5.4", "badgeLabel": "GPT-5.4 · Medium" },
                "reasoning": { "effort": "medium", "label": "Medium" },
                "features": {
                  "modelPickerEnabled": false,
                  "dictationEnabled": true,
                  "attachmentsEnabled": true
                },
                "liveUrl": null
              },
              "activeRun": null
            }
            """.trimIndent()
        )

        assertEquals(0, response.composerSuggestions.size)
    }

    @Test
    fun decodeBootstrapEnvelopeIncludesActiveRun() {
        val response = decodeAiChatBootstrapResponse(
            payload = """
            {
              "sessionId": "session-1",
              "conversationScopeId": "session-1",
              "conversation": {
                "updatedAt": 111,
                "mainContentInvalidationVersion": 222,
                "messages": [],
                "hasOlder": false,
                "oldestCursor": null
              },
              "composerSuggestions": [],
              "chatConfig": {
                "provider": { "id": "openai", "label": "OpenAI" },
                "model": { "id": "gpt-5.4", "label": "GPT-5.4", "badgeLabel": "GPT-5.4 · Medium" },
                "reasoning": { "effort": "medium", "label": "Medium" },
                "features": {
                  "modelPickerEnabled": false,
                  "dictationEnabled": true,
                  "attachmentsEnabled": true
                },
                "liveUrl": "http://localhost/live"
              },
              "activeRun": {
                "runId": "run-1",
                "status": "running",
                "live": {
                  "cursor": "5",
                  "stream": {
                    "url": "http://localhost/live",
                    "authorization": "Live token-1",
                    "expiresAt": 123
                  }
                },
                "lastHeartbeatAt": 456
              }
            }
            """.trimIndent()
        )

        assertEquals("session-1", response.sessionId)
        assertEquals("session-1", response.conversationScopeId)
        assertEquals("run-1", response.activeRun?.runId)
        assertEquals("5", response.activeRun?.live?.cursor)
    }

    @Test
    fun decodeNewSessionWithoutComposerSuggestionsDefaultsToEmptyList() {
        val response = decodeAiChatNewSession(
            payload = """
            {
              "sessionId": "session-1",
              "chatConfig": {
                "provider": { "id": "openai", "label": "OpenAI" },
                "model": { "id": "gpt-5.4", "label": "GPT-5.4", "badgeLabel": "GPT-5.4 · Medium" },
                "reasoning": { "effort": "medium", "label": "Medium" },
                "features": {
                  "modelPickerEnabled": false,
                  "dictationEnabled": true,
                  "attachmentsEnabled": true
                },
                "liveUrl": null
              }
            }
            """.trimIndent()
        )

        assertEquals(0, response.composerSuggestions.size)
    }

    @Test
    fun decodeAiChatSessionSnapshotMapsToolCallWithoutSyncField() {
        val snapshot = decodeAiChatSessionSnapshot(
            payload = """
            {
              "sessionId": "session-1",
              "conversationScopeId": "session-1",
              "conversation": {
                "updatedAt": 111,
                "mainContentInvalidationVersion": 222,
                "messages": [
                  {
                    "role": "assistant",
                    "content": [
                      {
                        "type": "tool_call",
                        "id": "tool-1",
                        "name": "sql",
                        "status": "completed"
                      }
                    ],
                    "timestamp": 123,
                    "isError": false,
                    "isStopped": false
                  }
                ],
                "hasOlder": false,
                "oldestCursor": null
              },
              "composerSuggestions": [],
              "chatConfig": {
                "provider": { "id": "openai", "label": "OpenAI" },
                "model": { "id": "gpt-5.4", "label": "GPT-5.4", "badgeLabel": "GPT-5.4 · Medium" },
                "reasoning": { "effort": "medium", "label": "Medium" },
                "features": {
                  "modelPickerEnabled": false,
                  "dictationEnabled": true,
                  "attachmentsEnabled": true
                },
                "liveUrl": null
              },
              "activeRun": null
            }
            """.trimIndent()
        )

        val toolCall = ((snapshot.conversation.messages.single().content.single()) as AiChatContentPart.ToolCall).toolCall
        assertEquals("tool-1", toolCall.toolCallId)
        assertEquals("sql", toolCall.name)
    }

    @Test
    fun decodeAiChatGuestSessionMapsDomainValues() {
        val session = decodeAiChatGuestSession(
            payload = """
            {
              "guestToken": "guest-token",
              "userId": "user-1",
              "workspaceId": "workspace-1"
            }
            """.trimIndent(),
            apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
            configurationMode = CloudServiceConfigurationMode.OFFICIAL
        )

        assertEquals("guest-token", session.guestToken)
        assertEquals("user-1", session.userId)
        assertEquals("workspace-1", session.workspaceId)
        assertEquals("https://api.flashcards-open-source-app.com/v1", session.apiBaseUrl)
    }
}
