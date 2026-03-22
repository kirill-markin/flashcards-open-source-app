package com.flashcardsopensourceapp.data.local.ai

import android.content.Context
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.AiChatRole
import com.flashcardsopensourceapp.data.local.model.AiChatToolCall
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import com.flashcardsopensourceapp.data.local.model.aiChatModelOptions
import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

private const val aiChatHistoryPreferencesName: String = "flashcards-ai-chat-history"
private const val aiChatDefaultHistoryKey: String = "ai-chat-history"
private const val aiChatWorkspaceHistoryPrefix: String = "ai-chat-history::"
private const val aiChatMaxMessages: Int = 200

class AiChatHistoryStore(
    context: Context
) {
    private val preferences =
        context.getSharedPreferences(aiChatHistoryPreferencesName, Context.MODE_PRIVATE)

    suspend fun loadState(workspaceId: String?): AiChatPersistedState = withContext(Dispatchers.IO) {
        val rawValue = preferences.getString(storageKey(workspaceId = workspaceId), null)
            ?: return@withContext makeDefaultAiChatPersistedState()

        return@withContext try {
            decodeState(rawValue = rawValue)
        } catch (_: Exception) {
            clearState(workspaceId = workspaceId)
            makeDefaultAiChatPersistedState()
        }
    }

    suspend fun saveState(workspaceId: String?, state: AiChatPersistedState) = withContext(Dispatchers.IO) {
        val trimmedState = state.copy(messages = state.messages.takeLast(aiChatMaxMessages))
        preferences.edit()
            .putString(storageKey(workspaceId = workspaceId), encodeState(state = trimmedState).toString())
            .apply()
    }

    suspend fun clearState(workspaceId: String?) = withContext(Dispatchers.IO) {
        preferences.edit().remove(storageKey(workspaceId = workspaceId)).apply()
    }

    private fun storageKey(workspaceId: String?): String {
        if (workspaceId.isNullOrBlank()) {
            return aiChatDefaultHistoryKey
        }

        return aiChatWorkspaceHistoryPrefix + workspaceId
    }

    private fun encodeState(state: AiChatPersistedState): JSONObject {
        return JSONObject()
            .put("messages", JSONArray(state.messages.map(::encodeMessage)))
            .put("selectedModelId", state.selectedModelId)
            .put("chatSessionId", state.chatSessionId)
            .put("codeInterpreterContainerId", state.codeInterpreterContainerId)
    }

    private fun decodeState(rawValue: String): AiChatPersistedState {
        val jsonObject = JSONObject(rawValue)
        val messages = jsonObject.optJSONArray("messages")
            ?.let(::decodeMessages)
            ?.takeLast(aiChatMaxMessages)
            ?: emptyList()
        val selectedModelId = jsonObject.optString("selectedModelId", "")
            .takeIf { modelId ->
                aiChatModelOptions.any { option -> option.id == modelId }
            }
            ?: makeDefaultAiChatPersistedState().selectedModelId
        val chatSessionId = jsonObject.optString("chatSessionId", "")
            .ifBlank { makeDefaultAiChatPersistedState().chatSessionId }
        val codeInterpreterContainerId =
            jsonObject.optString("codeInterpreterContainerId", "").ifBlank { null }

        return AiChatPersistedState(
            messages = messages,
            selectedModelId = selectedModelId,
            chatSessionId = chatSessionId,
            codeInterpreterContainerId = codeInterpreterContainerId
        )
    }

    private fun encodeMessage(message: AiChatMessage): JSONObject {
        return JSONObject()
            .put("messageId", message.messageId)
            .put("role", message.role.name)
            .put("content", JSONArray(message.content.map(::encodeContentPart)))
            .put("timestampMillis", message.timestampMillis)
            .put("isError", message.isError)
    }

    private fun decodeMessages(jsonArray: JSONArray): List<AiChatMessage> {
        return buildList {
            for (index in 0 until jsonArray.length()) {
                add(decodeMessage(jsonObject = jsonArray.getJSONObject(index)))
            }
        }
    }

    private fun decodeMessage(jsonObject: JSONObject): AiChatMessage {
        return AiChatMessage(
            messageId = jsonObject.getString("messageId"),
            role = AiChatRole.valueOf(jsonObject.getString("role")),
            content = decodeContentParts(jsonArray = jsonObject.getJSONArray("content")),
            timestampMillis = jsonObject.getLong("timestampMillis"),
            isError = jsonObject.getBoolean("isError")
        )
    }

    private fun encodeContentPart(contentPart: AiChatContentPart): JSONObject {
        return when (contentPart) {
            is AiChatContentPart.Text -> JSONObject()
                .put("type", "text")
                .put("text", contentPart.text)

            is AiChatContentPart.ToolCall -> JSONObject()
                .put("type", "tool_call")
                .put("toolCallId", contentPart.toolCall.toolCallId)
                .put("name", contentPart.toolCall.name)
                .put("status", contentPart.toolCall.status.name)
                .put("input", contentPart.toolCall.input)
                .put("output", contentPart.toolCall.output)

            is AiChatContentPart.AccountUpgradePrompt -> JSONObject()
                .put("type", "account_upgrade_prompt")
                .put("message", contentPart.message)
                .put("buttonTitle", contentPart.buttonTitle)
        }
    }

    private fun decodeContentParts(jsonArray: JSONArray): List<AiChatContentPart> {
        return buildList {
            for (index in 0 until jsonArray.length()) {
                add(decodeContentPart(jsonObject = jsonArray.getJSONObject(index)))
            }
        }
    }

    private fun decodeContentPart(jsonObject: JSONObject): AiChatContentPart {
        return when (jsonObject.getString("type")) {
            "text" -> AiChatContentPart.Text(
                text = jsonObject.getString("text")
            )

            "tool_call" -> AiChatContentPart.ToolCall(
                toolCall = AiChatToolCall(
                    toolCallId = jsonObject.getString("toolCallId"),
                    name = jsonObject.getString("name"),
                    status = AiChatToolCallStatus.valueOf(jsonObject.getString("status")),
                    input = jsonObject.optString("input", "").ifBlank { null },
                    output = jsonObject.optString("output", "").ifBlank { null }
                )
            )

            "account_upgrade_prompt" -> AiChatContentPart.AccountUpgradePrompt(
                message = jsonObject.getString("message"),
                buttonTitle = jsonObject.getString("buttonTitle")
            )

            else -> throw IllegalArgumentException("Unsupported AI chat content type.")
        }
    }
}
