package com.flashcardsopensourceapp.data.local.ai

import android.content.Context
import androidx.core.content.edit
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.AiChatRole
import com.flashcardsopensourceapp.data.local.model.AiChatServerConfig
import com.flashcardsopensourceapp.data.local.model.AiChatToolCall
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import com.flashcardsopensourceapp.data.local.model.defaultAiChatServerConfig
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
        preferences.edit(commit = true) {
            putString(storageKey(workspaceId = workspaceId), encodeState(state = trimmedState).toString())
        }
    }

    suspend fun clearState(workspaceId: String?) = withContext(Dispatchers.IO) {
        preferences.edit(commit = true) {
            remove(storageKey(workspaceId = workspaceId))
        }
    }

    suspend fun clearAllState() = withContext(Dispatchers.IO) {
        preferences.edit(commit = true) {
            clear()
        }
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
            .put("chatSessionId", state.chatSessionId)
            .put("lastKnownChatConfig", state.lastKnownChatConfig?.let(::encodeChatConfig))
    }

    private fun decodeState(rawValue: String): AiChatPersistedState {
        val jsonObject = JSONObject(rawValue)
        val messages = jsonObject.optJSONArray("messages")
            ?.let(::decodeMessages)
            ?.takeLast(aiChatMaxMessages)
            ?: emptyList()
        val chatSessionId = jsonObject.optString("chatSessionId", "")
        val lastKnownChatConfig = jsonObject.optJSONObject("lastKnownChatConfig")
            ?.let(::decodeChatConfig)

        return AiChatPersistedState(
            messages = messages,
            chatSessionId = chatSessionId,
            lastKnownChatConfig = lastKnownChatConfig
        )
    }

    private fun encodeChatConfig(config: AiChatServerConfig): JSONObject {
        return JSONObject()
            .put(
                "provider",
                JSONObject()
                    .put("id", config.provider.id)
                    .put("label", config.provider.label)
            )
            .put(
                "model",
                JSONObject()
                    .put("id", config.model.id)
                    .put("label", config.model.label)
                    .put("badgeLabel", config.model.badgeLabel)
            )
            .put(
                "reasoning",
                JSONObject()
                    .put("effort", config.reasoning.effort)
                    .put("label", config.reasoning.label)
            )
            .put(
                "features",
                JSONObject()
                    .put("modelPickerEnabled", config.features.modelPickerEnabled)
                    .put("dictationEnabled", config.features.dictationEnabled)
                    .put("attachmentsEnabled", config.features.attachmentsEnabled)
            )
    }

    private fun decodeChatConfig(jsonObject: JSONObject): AiChatServerConfig {
        val provider = jsonObject.optJSONObject("provider")
        val model = jsonObject.optJSONObject("model")
        val reasoning = jsonObject.optJSONObject("reasoning")
        val features = jsonObject.optJSONObject("features")

        if (provider == null || model == null || reasoning == null || features == null) {
            return defaultAiChatServerConfig
        }

        return AiChatServerConfig(
            provider = com.flashcardsopensourceapp.data.local.model.AiChatProvider(
                id = provider.optString("id", defaultAiChatServerConfig.provider.id),
                label = provider.optString("label", defaultAiChatServerConfig.provider.label)
            ),
            model = com.flashcardsopensourceapp.data.local.model.AiChatServerModel(
                id = model.optString("id", defaultAiChatServerConfig.model.id),
                label = model.optString("label", defaultAiChatServerConfig.model.label),
                badgeLabel = model.optString("badgeLabel", defaultAiChatServerConfig.model.badgeLabel)
            ),
            reasoning = com.flashcardsopensourceapp.data.local.model.AiChatReasoning(
                effort = reasoning.optString("effort", defaultAiChatServerConfig.reasoning.effort),
                label = reasoning.optString("label", defaultAiChatServerConfig.reasoning.label)
            ),
            features = com.flashcardsopensourceapp.data.local.model.AiChatFeatures(
                modelPickerEnabled = features.optBoolean("modelPickerEnabled", false),
                dictationEnabled = features.optBoolean("dictationEnabled", true),
                attachmentsEnabled = features.optBoolean("attachmentsEnabled", true)
            )
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

            is AiChatContentPart.ReasoningSummary -> JSONObject()
                .put("type", "reasoning_summary")
                .put("summary", contentPart.summary)

            is AiChatContentPart.Image -> JSONObject()
                .put("type", "image")
                .put("fileName", contentPart.fileName)
                .put("mediaType", contentPart.mediaType)
                .put("base64Data", contentPart.base64Data)

            is AiChatContentPart.File -> JSONObject()
                .put("type", "file")
                .put("fileName", contentPart.fileName)
                .put("mediaType", contentPart.mediaType)
                .put("base64Data", contentPart.base64Data)

            is AiChatContentPart.ToolCall -> JSONObject()
                .put("type", "tool_call")
                .put("id", contentPart.toolCall.toolCallId)
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

            "reasoning_summary" -> AiChatContentPart.ReasoningSummary(
                summary = jsonObject.getString("summary")
            )

            "image" -> AiChatContentPart.Image(
                fileName = jsonObject.optString("fileName", "").ifBlank { null },
                mediaType = jsonObject.getString("mediaType"),
                base64Data = jsonObject.getString("base64Data")
            )

            "file" -> AiChatContentPart.File(
                fileName = jsonObject.getString("fileName"),
                mediaType = jsonObject.getString("mediaType"),
                base64Data = jsonObject.getString("base64Data")
            )

            "tool_call" -> AiChatContentPart.ToolCall(
                toolCall = AiChatToolCall(
                    toolCallId = jsonObject.getString("id"),
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
