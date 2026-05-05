package com.flashcardsopensourceapp.data.local.ai

import com.flashcardsopensourceapp.data.local.cloud.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.model.AiChatAcceptedConversationEnvelope
import com.flashcardsopensourceapp.data.local.model.AiChatActiveRun
import com.flashcardsopensourceapp.data.local.model.AiChatActiveRunLive
import com.flashcardsopensourceapp.data.local.model.AiChatBootstrapResponse
import com.flashcardsopensourceapp.data.local.model.AiChatComposerSuggestion
import com.flashcardsopensourceapp.data.local.model.AiChatConversation
import com.flashcardsopensourceapp.data.local.model.AiChatConversationEnvelope
import com.flashcardsopensourceapp.data.local.model.AiChatFeatures
import com.flashcardsopensourceapp.data.local.model.AiChatLiveStreamEnvelope
import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatProvider
import com.flashcardsopensourceapp.data.local.model.AiChatReasoning
import com.flashcardsopensourceapp.data.local.model.AiChatRole
import com.flashcardsopensourceapp.data.local.model.AiChatServerConfig
import com.flashcardsopensourceapp.data.local.model.AiChatServerModel
import com.flashcardsopensourceapp.data.local.model.AiChatSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.AiChatStartRunResponse
import com.flashcardsopensourceapp.data.local.model.AiChatStopRunResponse
import com.flashcardsopensourceapp.data.local.model.AiChatTranscriptionResult
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.StoredGuestAiSession
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
private enum class AiChatRoleWire {
    @SerialName("user") USER,
    @SerialName("assistant") ASSISTANT,
}

@Serializable
private data class AiChatProviderWire(
    val id: StrictRemoteString,
    val label: StrictRemoteString
)

@Serializable
private data class AiChatServerModelWire(
    val id: StrictRemoteString,
    val label: StrictRemoteString,
    val badgeLabel: StrictRemoteString
)

@Serializable
private data class AiChatReasoningWire(
    val effort: StrictRemoteString,
    val label: StrictRemoteString
)

@Serializable
private data class AiChatFeaturesWire(
    val modelPickerEnabled: StrictRemoteBoolean,
    val dictationEnabled: StrictRemoteBoolean,
    val attachmentsEnabled: StrictRemoteBoolean
)

@Serializable
private data class AiChatServerConfigWire(
    val provider: AiChatProviderWire,
    val model: AiChatServerModelWire,
    val reasoning: AiChatReasoningWire,
    val features: AiChatFeaturesWire
)

@Serializable
private data class AiChatLiveStreamEnvelopeWire(
    val url: StrictRemoteString,
    val authorization: StrictRemoteString,
    val expiresAt: StrictRemoteLong
)

@Serializable
private data class AiChatGuestSessionWire(
    val guestToken: StrictRemoteString,
    val userId: StrictRemoteString,
    val workspaceId: StrictRemoteString
)

@Serializable
private data class AiChatConversationWire(
    val messages: List<AiChatConversationMessageWire>,
    val updatedAt: StrictRemoteLong,
    val mainContentInvalidationVersion: StrictRemoteLong,
    val hasOlder: StrictRemoteBoolean? = null,
    val oldestCursor: StrictRemoteString? = null
)

@Serializable
private data class AiChatActiveRunLiveWire(
    val cursor: StrictRemoteString? = null,
    val stream: AiChatLiveStreamEnvelopeWire
)

@Serializable
private data class AiChatActiveRunWire(
    val runId: StrictRemoteString,
    val status: StrictRemoteString,
    val live: AiChatActiveRunLiveWire,
    val lastHeartbeatAt: StrictRemoteLong? = null
)

@Serializable
private data class AiChatConversationEnvelopeWire(
    val sessionId: StrictRemoteString,
    val conversationScopeId: StrictRemoteString,
    val conversation: AiChatConversationWire,
    val composerSuggestions: List<AiChatComposerSuggestionWire> = emptyList(),
    val chatConfig: AiChatServerConfigWire,
    val activeRun: AiChatActiveRunWire? = null
)

@Serializable
private data class AiChatAcceptedConversationEnvelopeWire(
    val accepted: StrictRemoteBoolean,
    val sessionId: StrictRemoteString,
    val conversationScopeId: StrictRemoteString,
    val conversation: AiChatConversationWire,
    val composerSuggestions: List<AiChatComposerSuggestionWire> = emptyList(),
    val chatConfig: AiChatServerConfigWire,
    val activeRun: AiChatActiveRunWire? = null,
    val deduplicated: StrictRemoteBoolean? = null
)

@Serializable
private data class AiChatStopRunResponseWire(
    val sessionId: StrictRemoteString,
    val stopped: StrictRemoteBoolean,
    val stillRunning: StrictRemoteBoolean
)

@Serializable
private data class AiChatConversationMessageWire(
    val role: AiChatRoleWire,
    val content: List<JsonObject>,
    val timestamp: StrictRemoteLong,
    val isError: StrictRemoteBoolean,
    val isStopped: StrictRemoteBoolean,
    val cursor: StrictRemoteString? = null,
    val itemId: StrictRemoteString? = null
)

@Serializable
private data class AiChatNewSessionWire(
    val sessionId: StrictRemoteString,
    val composerSuggestions: List<AiChatComposerSuggestionWire> = emptyList(),
    val chatConfig: AiChatServerConfigWire
)

@Serializable
internal data class AiChatComposerSuggestionWire(
    val id: StrictRemoteString,
    val text: StrictRemoteString,
    val source: StrictRemoteString,
    val assistantItemId: StrictRemoteString? = null
)

@Serializable
private data class AiChatTranscriptionWire(
    val text: StrictRemoteString,
    val sessionId: StrictRemoteString
)

internal fun decodeAiChatGuestSession(
    payload: String,
    apiBaseUrl: String,
    configurationMode: CloudServiceConfigurationMode
): StoredGuestAiSession {
    val wire = decodeAiChatWire<AiChatGuestSessionWire>(payload = payload, context = "guest-auth/session")
    return StoredGuestAiSession(
        guestToken = wire.guestToken.value,
        userId = wire.userId.value,
        workspaceId = wire.workspaceId.value,
        configurationMode = configurationMode,
        apiBaseUrl = apiBaseUrl
    )
}

internal fun decodeAiChatStartRunResponse(payload: String): AiChatStartRunResponse {
    val wire = decodeAiChatWire<AiChatAcceptedConversationEnvelopeWire>(payload = payload, context = "chat.start")
    return wire.asAcceptedConversationEnvelope()
}

internal fun decodeAiChatSessionSnapshot(payload: String): AiChatSessionSnapshot {
    val wire = decodeAiChatWire<AiChatConversationEnvelopeWire>(payload = payload, context = "chat.snapshot")
    return wire.asConversationEnvelope()
}

internal fun decodeAiChatBootstrapResponse(payload: String): AiChatBootstrapResponse {
    val wire = decodeAiChatWire<AiChatConversationEnvelopeWire>(payload = payload, context = "chat.bootstrap")
    return wire.asConversationEnvelope()
}

internal fun decodeAiChatNewSession(payload: String): AiChatSessionSnapshot {
    val wire = decodeAiChatWire<AiChatNewSessionWire>(payload = payload, context = "chat.new")
    return AiChatConversationEnvelope(
        sessionId = wire.sessionId.value,
        conversationScopeId = wire.sessionId.value,
        conversation = AiChatConversation(
            messages = emptyList(),
            updatedAtMillis = 0L,
            mainContentInvalidationVersion = 0L,
            hasOlder = false,
            oldestCursor = null
        ),
        composerSuggestions = wire.composerSuggestions.map(AiChatComposerSuggestionWire::asDomain),
        chatConfig = wire.chatConfig.asDomain(),
        activeRun = null
    )
}

internal fun decodeAiChatTranscription(payload: String): AiChatTranscriptionResult {
    val wire = decodeAiChatWire<AiChatTranscriptionWire>(payload = payload, context = "chat.transcription")
    return AiChatTranscriptionResult(
        text = wire.text.value,
        sessionId = wire.sessionId.value
    )
}

internal fun decodeAiChatStopRunResponse(payload: String): AiChatStopRunResponse {
    val wire = decodeAiChatWire<AiChatStopRunResponseWire>(payload = payload, context = "chat.stop")
    return AiChatStopRunResponse(
        sessionId = wire.sessionId.value,
        stopped = wire.stopped.value,
        stillRunning = wire.stillRunning.value
    )
}

private fun AiChatRoleWire.asDomain(): AiChatRole {
    return when (this) {
        AiChatRoleWire.USER -> AiChatRole.USER
        AiChatRoleWire.ASSISTANT -> AiChatRole.ASSISTANT
    }
}

private fun AiChatServerConfigWire.asDomain(): AiChatServerConfig {
    return AiChatServerConfig(
        provider = AiChatProvider(id = this.provider.id.value, label = this.provider.label.value),
        model = AiChatServerModel(
            id = this.model.id.value,
            label = this.model.label.value,
            badgeLabel = this.model.badgeLabel.value
        ),
        reasoning = AiChatReasoning(
            effort = this.reasoning.effort.value,
            label = this.reasoning.label.value
        ),
        features = AiChatFeatures(
            modelPickerEnabled = this.features.modelPickerEnabled.value,
            dictationEnabled = this.features.dictationEnabled.value,
            attachmentsEnabled = this.features.attachmentsEnabled.value
        )
    )
}

private fun AiChatLiveStreamEnvelopeWire.asDomain(): AiChatLiveStreamEnvelope {
    return AiChatLiveStreamEnvelope(
        url = this.url.value,
        authorization = this.authorization.value,
        expiresAt = this.expiresAt.value
    )
}

private fun AiChatConversationMessageWire.asDomain(sessionId: String, index: Int): AiChatMessage {
    val cursor = this.cursor?.value?.ifBlank { null }
    val messageId = cursor?.let { "$sessionId-$index-$it" } ?: "snapshot-$index"
    val resolvedItemId = this.itemId?.value?.ifBlank { null }
        ?: this.content.firstNotNullOfOrNull(::extractAiChatItemId)
    return AiChatMessage(
        messageId = messageId,
        role = this.role.asDomain(),
        content = this.content.map { part ->
            mapAiChatContentPart(
                part = part,
                sessionId = sessionId,
                messageId = messageId,
                source = "snapshot"
            )
        },
        timestampMillis = this.timestamp.value,
        isError = this.isError.value,
        isStopped = this.isStopped.value,
        cursor = cursor,
        itemId = resolvedItemId
    )
}

private fun AiChatConversationWire.asDomain(sessionId: String): AiChatConversation {
    return AiChatConversation(
        messages = this.messages.mapIndexed { index, message ->
            message.asDomain(sessionId = sessionId, index = index)
        },
        updatedAtMillis = this.updatedAt.value,
        mainContentInvalidationVersion = this.mainContentInvalidationVersion.value,
        hasOlder = this.hasOlder?.value ?: false,
        oldestCursor = this.oldestCursor?.value?.ifBlank { null }
    )
}

private fun AiChatActiveRunLiveWire.asDomain(): AiChatActiveRunLive {
    return AiChatActiveRunLive(
        cursor = this.cursor?.value?.ifBlank { null },
        stream = this.stream.asDomain()
    )
}

private fun AiChatActiveRunWire.asDomain(): AiChatActiveRun {
    val status = this.status.value
    if (status != "running") {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for activeRun.status: unsupported AI chat active run status \"$status\""
        )
    }
    return AiChatActiveRun(
        runId = this.runId.value,
        status = status,
        live = this.live.asDomain(),
        lastHeartbeatAtMillis = this.lastHeartbeatAt?.value
    )
}

private fun AiChatConversationEnvelopeWire.asConversationEnvelope(): AiChatConversationEnvelope {
    return AiChatConversationEnvelope(
        sessionId = this.sessionId.value,
        conversationScopeId = this.conversationScopeId.value,
        conversation = this.conversation.asDomain(sessionId = this.sessionId.value),
        composerSuggestions = this.composerSuggestions.map(AiChatComposerSuggestionWire::asDomain),
        chatConfig = this.chatConfig.asDomain(),
        activeRun = this.activeRun?.asDomain()
    )
}

private fun AiChatAcceptedConversationEnvelopeWire.asAcceptedConversationEnvelope(): AiChatAcceptedConversationEnvelope {
    return AiChatAcceptedConversationEnvelope(
        accepted = this.accepted.value,
        sessionId = this.sessionId.value,
        conversationScopeId = this.conversationScopeId.value,
        conversation = this.conversation.asDomain(sessionId = this.sessionId.value),
        composerSuggestions = this.composerSuggestions.map(AiChatComposerSuggestionWire::asDomain),
        chatConfig = this.chatConfig.asDomain(),
        activeRun = this.activeRun?.asDomain(),
        deduplicated = this.deduplicated?.value
    )
}

internal fun AiChatComposerSuggestionWire.asDomain(): AiChatComposerSuggestion {
    return AiChatComposerSuggestion(
        id = this.id.value,
        text = this.text.value,
        source = this.source.value,
        assistantItemId = this.assistantItemId?.value?.ifBlank { null }
    )
}
