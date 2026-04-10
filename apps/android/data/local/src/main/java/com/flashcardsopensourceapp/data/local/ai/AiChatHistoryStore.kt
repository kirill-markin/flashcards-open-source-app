package com.flashcardsopensourceapp.data.local.ai

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatDraftState
import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.AiChatReasoningSummary
import com.flashcardsopensourceapp.data.local.model.AiChatRole
import com.flashcardsopensourceapp.data.local.model.AiChatServerConfig
import com.flashcardsopensourceapp.data.local.model.AiChatToolCall
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.defaultAiChatServerConfig
import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatDraftState
import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.isEmpty
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

private const val aiChatHistoryPreferencesName: String = "flashcards-ai-chat-history"
private const val aiChatDefaultHistoryKey: String = "ai-chat-history"
private const val aiChatWorkspaceHistoryPrefix: String = "ai-chat-history::"
private const val aiChatDefaultDraftKey: String = "ai-chat-draft"
private const val aiChatWorkspaceDraftPrefix: String = "ai-chat-draft::"
private const val aiChatMaxMessages: Int = 200

fun makeAiChatHistoryScopedWorkspaceId(
    workspaceId: String?,
    cloudSettings: CloudSettings
): String {
    val normalizedWorkspaceId = workspaceId?.trim()?.takeIf { value ->
        value.isNotEmpty()
    } ?: "default"

    return when (cloudSettings.cloudState) {
        CloudAccountState.LINKED -> {
            val normalizedUserId = cloudSettings.linkedUserId?.trim()?.takeIf { value ->
                value.isNotEmpty()
            } ?: "linked-user"
            val normalizedActiveWorkspaceId = cloudSettings.activeWorkspaceId?.trim()?.takeIf { value ->
                value.isNotEmpty()
            } ?: normalizedWorkspaceId
            "linked::$normalizedUserId::$normalizedActiveWorkspaceId"
        }

        CloudAccountState.GUEST -> {
            val normalizedUserId = cloudSettings.linkedUserId?.trim()?.takeIf { value ->
                value.isNotEmpty()
            } ?: "guest-user"
            "guest::$normalizedUserId::$normalizedWorkspaceId"
        }

        CloudAccountState.DISCONNECTED,
        CloudAccountState.LINKING_READY -> "local::$normalizedWorkspaceId"
    }
}

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
        } catch (error: Exception) {
            AiChatDiagnosticsLogger.error(
                event = "ai_chat_history_load_failed",
                fields = listOf(
                    "workspaceId" to workspaceId,
                    "storageKey" to storageKey(workspaceId = workspaceId),
                    "message" to error.message
                ),
                throwable = error
            )
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

    suspend fun loadDraftState(workspaceId: String?, sessionId: String?): AiChatDraftState = withContext(Dispatchers.IO) {
        val resolvedSessionId = normalizeSessionId(sessionId = sessionId)
            ?: return@withContext makeDefaultAiChatDraftState()
        val draftKey = draftStorageKey(workspaceId = workspaceId, sessionId = resolvedSessionId)
        val rawValue = preferences.getString(draftKey, null)
        if (rawValue != null) {
            return@withContext try {
                decodeDraftState(rawValue = rawValue)
            } catch (error: Exception) {
                AiChatDiagnosticsLogger.error(
                    event = "ai_chat_draft_load_failed",
                    fields = listOf(
                        "workspaceId" to workspaceId,
                        "sessionId" to sessionId,
                        "storageKey" to draftKey,
                        "message" to error.message
                    ),
                    throwable = error
                )
                clearDraftStorageKey(workspaceId = workspaceId, sessionId = resolvedSessionId)
                makeDefaultAiChatDraftState()
            }
        }
        return@withContext makeDefaultAiChatDraftState()
    }

    suspend fun saveDraftState(workspaceId: String?, sessionId: String?, state: AiChatDraftState) = withContext(Dispatchers.IO) {
        val normalizedSessionId = normalizeSessionId(sessionId = sessionId)
            ?: throw IllegalArgumentException("AI chat draft state requires a sessionId.")
        val storageKey = draftStorageKey(workspaceId = workspaceId, sessionId = normalizedSessionId)
        if (state.isEmpty()) {
            preferences.edit(commit = true) {
                remove(storageKey)
            }
            return@withContext
        }

        preferences.edit(commit = true) {
            putString(storageKey, encodeDraftState(draftState = state).toString())
        }
    }

    suspend fun clearDraftState(workspaceId: String?, sessionId: String?) = withContext(Dispatchers.IO) {
        val normalizedSessionId = normalizeSessionId(sessionId = sessionId) ?: return@withContext
        clearDraftStorageKey(
            workspaceId = workspaceId,
            sessionId = normalizedSessionId
        )
    }

    suspend fun clearAllState() = withContext(Dispatchers.IO) {
        preferences.edit(commit = true) {
            clear()
        }
    }

    fun observeState(workspaceId: String?): Flow<AiChatPersistedState> {
        val key = storageKey(workspaceId = workspaceId)
        return callbackFlow {
            val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, changedKey ->
                if (changedKey == null || changedKey == key) {
                    trySend(currentState(workspaceId = workspaceId))
                }
            }
            trySend(currentState(workspaceId = workspaceId))
            preferences.registerOnSharedPreferenceChangeListener(listener)
            awaitClose {
                preferences.unregisterOnSharedPreferenceChangeListener(listener)
            }
        }
    }

    private fun storageKey(workspaceId: String?): String {
        if (workspaceId.isNullOrBlank()) {
            return aiChatDefaultHistoryKey
        }

        return aiChatWorkspaceHistoryPrefix + workspaceId
    }

    private fun draftStorageKey(workspaceId: String?, sessionId: String): String {
        if (workspaceId.isNullOrBlank()) {
            return aiChatDefaultDraftKey + "::" + sessionId
        }

        return aiChatWorkspaceDraftPrefix + workspaceId + "::" + sessionId
    }

    private fun normalizeSessionId(sessionId: String?): String? {
        return sessionId?.trim()?.takeIf { value -> value.isNotEmpty() }
    }

    private fun encodeState(state: AiChatPersistedState): JSONObject {
        return JSONObject()
            .put("messages", JSONArray(state.messages.map(::encodeMessage)))
            .put("chatSessionId", state.chatSessionId)
            .put("lastKnownChatConfig", state.lastKnownChatConfig?.let(::encodeChatConfig))
            .put("pendingToolRunPostSync", state.pendingToolRunPostSync)
    }

    private fun decodeState(rawValue: String): AiChatPersistedState {
        val jsonObject = JSONObject(rawValue)
        val chatSessionId = jsonObject.optString("chatSessionId", "")
        val messages = jsonObject.optJSONArray("messages")
            ?.let { jsonArray ->
                decodeMessages(
                    jsonArray = jsonArray,
                    sessionId = chatSessionId
                )
            }
            ?.takeLast(aiChatMaxMessages)
            ?: emptyList()
        val lastKnownChatConfig = jsonObject.optJSONObject("lastKnownChatConfig")
            ?.let(::decodeChatConfig)

        return AiChatPersistedState(
            messages = messages,
            chatSessionId = chatSessionId,
            lastKnownChatConfig = lastKnownChatConfig,
            pendingToolRunPostSync = jsonObject.optBoolean("pendingToolRunPostSync", false)
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
            .put("isStopped", message.isStopped)
            .put("cursor", message.cursor ?: JSONObject.NULL)
            .put("itemId", message.itemId ?: JSONObject.NULL)
    }

    private fun decodeMessages(jsonArray: JSONArray, sessionId: String): List<AiChatMessage> {
        return buildList {
            for (index in 0 until jsonArray.length()) {
                add(
                    decodeMessage(
                        jsonObject = jsonArray.getJSONObject(index),
                        sessionId = sessionId
                    )
                )
            }
        }
    }

    private fun decodeMessage(jsonObject: JSONObject, sessionId: String): AiChatMessage {
        val messageId = jsonObject.getString("messageId")
        return AiChatMessage(
            messageId = messageId,
            role = AiChatRole.valueOf(jsonObject.getString("role")),
            content = decodeContentParts(
                jsonArray = jsonObject.getJSONArray("content"),
                sessionId = sessionId,
                messageId = messageId
            ),
            timestampMillis = jsonObject.getLong("timestampMillis"),
            isError = jsonObject.getBoolean("isError"),
            isStopped = jsonObject.optBoolean("isStopped", false),
            cursor = jsonObject.optString("cursor", "").ifBlank { null },
            itemId = jsonObject.optString("itemId", "").ifBlank { null }
        )
    }

    private fun encodeContentPart(contentPart: AiChatContentPart): JSONObject {
        return when (contentPart) {
            is AiChatContentPart.Text -> JSONObject()
                .put("type", "text")
                .put("text", contentPart.text)

            is AiChatContentPart.ReasoningSummary -> JSONObject()
                .put("type", "reasoning_summary")
                .put("id", contentPart.reasoningSummary.reasoningId)
                .put("summary", contentPart.reasoningSummary.summary)
                .put("status", contentPart.reasoningSummary.status.name)

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

            is AiChatContentPart.Card -> JSONObject()
                .put("type", "card")
                .put("cardId", contentPart.cardId)
                .put("frontText", contentPart.frontText)
                .put("backText", contentPart.backText)
                .put("tags", JSONArray(contentPart.tags))
                .put("effortLevel", contentPart.effortLevel.name)

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

            is AiChatContentPart.Unknown -> JSONObject()
                .put("type", "unknown")
                .put("originalType", contentPart.originalType)
                .put("summaryText", contentPart.summaryText)
                .put("rawPayloadJson", contentPart.rawPayloadJson ?: JSONObject.NULL)
        }
    }

    private fun decodeContentParts(
        jsonArray: JSONArray,
        sessionId: String,
        messageId: String
    ): List<AiChatContentPart> {
        return buildList {
            for (index in 0 until jsonArray.length()) {
                add(
                    decodeContentPart(
                        jsonObject = jsonArray.getJSONObject(index),
                        sessionId = sessionId,
                        messageId = messageId
                    )
                )
            }
        }
    }

    private fun decodeContentPart(
        jsonObject: JSONObject,
        sessionId: String,
        messageId: String
    ): AiChatContentPart {
        val storedType = jsonObject.getString("type")
        return when (storedType) {
            "text" -> AiChatContentPart.Text(
                text = jsonObject.getString("text")
            )

            "reasoning_summary" -> AiChatContentPart.ReasoningSummary(
                reasoningSummary = AiChatReasoningSummary(
                    reasoningId = jsonObject.optString("id", "").ifBlank {
                        jsonObject.getString("summary")
                    },
                    summary = jsonObject.getString("summary"),
                    status = jsonObject.optString("status", AiChatToolCallStatus.COMPLETED.name)
                        .takeIf { it == AiChatToolCallStatus.STARTED.name || it == AiChatToolCallStatus.COMPLETED.name }
                        ?.let(AiChatToolCallStatus::valueOf)
                        ?: AiChatToolCallStatus.COMPLETED
                )
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

            "card" -> AiChatContentPart.Card(
                cardId = jsonObject.getString("cardId"),
                frontText = jsonObject.getString("frontText"),
                backText = jsonObject.getString("backText"),
                tags = jsonObject.optJSONArray("tags")?.let(::decodeStringArray) ?: emptyList(),
                effortLevel = decodeEffortLevel(jsonObject = jsonObject)
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

            "unknown" -> decodeUnknownContentPart(
                jsonObject = jsonObject,
                fallbackType = storedType,
                sessionId = sessionId,
                messageId = messageId
            )

            else -> decodeUnknownContentPart(
                jsonObject = jsonObject,
                fallbackType = storedType,
                sessionId = sessionId,
                messageId = messageId
            )
        }
    }

    private fun encodeDraftState(draftState: AiChatDraftState): JSONObject {
        return JSONObject()
            .put("draftMessage", draftState.draftMessage)
            .put("pendingAttachments", JSONArray(draftState.pendingAttachments.map(::encodeAttachment)))
    }

    private fun decodeDraftState(rawValue: String): AiChatDraftState {
        val jsonObject = JSONObject(rawValue)
        val draftMessage = jsonObject.optString("draftMessage", "")
        val pendingAttachments = jsonObject.optJSONArray("pendingAttachments")
            ?.let(::decodeAttachments)
            ?: emptyList()

        return AiChatDraftState(
            draftMessage = draftMessage,
            pendingAttachments = pendingAttachments
        )
    }

    private fun encodeAttachment(attachment: AiChatAttachment): JSONObject {
        return when (attachment) {
            is AiChatAttachment.Binary -> JSONObject()
                .put("type", "binary")
                .put("id", attachment.id)
                .put("fileName", attachment.fileName)
                .put("mediaType", attachment.mediaType)
                .put("base64Data", attachment.base64Data)

            is AiChatAttachment.Card -> JSONObject()
                .put("type", "card")
                .put("id", attachment.id)
                .put("cardId", attachment.cardId)
                .put("frontText", attachment.frontText)
                .put("backText", attachment.backText)
                .put("tags", JSONArray(attachment.tags))
                .put("effortLevel", attachment.effortLevel.name)

            is AiChatAttachment.Unknown -> JSONObject()
                .put("type", "unknown")
                .put("id", attachment.id)
                .put("originalType", attachment.originalType)
                .put("summaryText", attachment.summaryText)
                .put("rawPayloadJson", attachment.rawPayloadJson ?: JSONObject.NULL)
        }
    }

    private fun decodeAttachments(jsonArray: JSONArray): List<AiChatAttachment> {
        return buildList {
            for (index in 0 until jsonArray.length()) {
                add(decodeAttachment(jsonObject = jsonArray.getJSONObject(index)))
            }
        }
    }

    private fun decodeAttachment(jsonObject: JSONObject): AiChatAttachment {
        val storedType = jsonObject.getString("type")
        return when (storedType) {
            "binary" -> AiChatAttachment.Binary(
                id = jsonObject.getString("id"),
                fileName = jsonObject.getString("fileName"),
                mediaType = jsonObject.getString("mediaType"),
                base64Data = jsonObject.getString("base64Data")
            )

            "card" -> AiChatAttachment.Card(
                id = jsonObject.getString("id"),
                cardId = jsonObject.getString("cardId"),
                frontText = jsonObject.getString("frontText"),
                backText = jsonObject.getString("backText"),
                tags = jsonObject.optJSONArray("tags")?.let(::decodeStringArray) ?: emptyList(),
                effortLevel = decodeEffortLevel(jsonObject = jsonObject)
            )

            "unknown" -> AiChatAttachment.Unknown(
                id = jsonObject.optString("id", "").ifBlank {
                    UUID.randomUUID().toString().lowercase()
                },
                originalType = jsonObject.optString("originalType", storedType).ifBlank { storedType },
                summaryText = jsonObject.optString("summaryText", "Unsupported attachment"),
                rawPayloadJson = jsonObject.optString("rawPayloadJson", "").ifBlank { null }
            )

            else -> AiChatAttachment.Unknown(
                id = jsonObject.optString("id", "").ifBlank {
                    UUID.randomUUID().toString().lowercase()
                },
                originalType = storedType,
                summaryText = "Unsupported attachment",
                rawPayloadJson = jsonObject.toString()
            )
        }
    }

    private fun decodeUnknownContentPart(
        jsonObject: JSONObject,
        fallbackType: String,
        sessionId: String,
        messageId: String
    ): AiChatContentPart.Unknown {
        val originalType = jsonObject.optString("originalType", fallbackType).ifBlank { fallbackType }
        AiChatDiagnosticsLogger.logUnknownContentReceived(
            originalType = originalType,
            sessionId = sessionId,
            messageId = messageId,
            source = "local_history"
        )
        return AiChatContentPart.Unknown(
            originalType = originalType,
            summaryText = jsonObject.optString("summaryText", "Unsupported content"),
            rawPayloadJson = jsonObject.optString("rawPayloadJson", "").ifBlank {
                jsonObject.toString()
            }
        )
    }

    private fun decodeEffortLevel(jsonObject: JSONObject): EffortLevel {
        val rawValue = jsonObject.getString("effortLevel").trim()
        return when (rawValue) {
            EffortLevel.FAST.name -> EffortLevel.FAST
            EffortLevel.MEDIUM.name -> EffortLevel.MEDIUM
            EffortLevel.LONG.name -> EffortLevel.LONG
            else -> throw IllegalArgumentException("Invalid AI chat card effort level: $rawValue")
        }
    }

    private fun currentState(workspaceId: String?): AiChatPersistedState {
        val rawValue = preferences.getString(storageKey(workspaceId = workspaceId), null)
            ?: return makeDefaultAiChatPersistedState()

        return try {
            decodeState(rawValue = rawValue)
        } catch (_: Exception) {
            makeDefaultAiChatPersistedState()
        }
    }

    private fun clearDraftStorageKey(workspaceId: String?, sessionId: String) {
        preferences.edit(commit = true) {
            remove(draftStorageKey(workspaceId = workspaceId, sessionId = sessionId))
        }
    }

    private fun decodeStringArray(jsonArray: JSONArray): List<String> {
        return buildList {
            for (index in 0 until jsonArray.length()) {
                add(jsonArray.getString(index))
            }
        }
    }
}
