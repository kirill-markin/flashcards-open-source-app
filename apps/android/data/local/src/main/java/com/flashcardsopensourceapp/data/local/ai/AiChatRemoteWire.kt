package com.flashcardsopensourceapp.data.local.ai

import com.flashcardsopensourceapp.data.local.cloud.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.cloud.buildRemoteContractMismatch
import com.flashcardsopensourceapp.data.local.cloud.strictRemoteJson
import com.flashcardsopensourceapp.data.local.model.AiChatBootstrapResponse
import com.flashcardsopensourceapp.data.local.model.AiChatConversation
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatConversationEnvelope
import com.flashcardsopensourceapp.data.local.model.AiChatAcceptedConversationEnvelope
import com.flashcardsopensourceapp.data.local.model.AiChatActiveRun
import com.flashcardsopensourceapp.data.local.model.AiChatActiveRunLive
import com.flashcardsopensourceapp.data.local.model.AiChatLiveEvent
import com.flashcardsopensourceapp.data.local.model.AiChatLiveEventMetadata
import com.flashcardsopensourceapp.data.local.model.AiChatLiveStreamEnvelope
import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatOlderMessagesResponse
import com.flashcardsopensourceapp.data.local.model.AiChatProvider
import com.flashcardsopensourceapp.data.local.model.AiChatReasoning
import com.flashcardsopensourceapp.data.local.model.AiChatReasoningSummary
import com.flashcardsopensourceapp.data.local.model.AiChatRepairAttemptStatus
import com.flashcardsopensourceapp.data.local.model.AiChatRole
import com.flashcardsopensourceapp.data.local.model.AiChatRunTerminalOutcome
import com.flashcardsopensourceapp.data.local.model.AiChatServerConfig
import com.flashcardsopensourceapp.data.local.model.AiChatServerModel
import com.flashcardsopensourceapp.data.local.model.AiChatSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.AiChatStopRunResponse
import com.flashcardsopensourceapp.data.local.model.AiChatStartRunResponse
import com.flashcardsopensourceapp.data.local.model.AiChatToolCall
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import com.flashcardsopensourceapp.data.local.model.AiChatTranscriptionResult
import com.flashcardsopensourceapp.data.local.model.AiChatFeatures
import com.flashcardsopensourceapp.data.local.model.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull

@JvmInline
@Serializable(with = StrictRemoteStringSerializer::class)
private value class StrictRemoteString(val value: String)

@JvmInline
@Serializable(with = StrictRemoteBooleanSerializer::class)
private value class StrictRemoteBoolean(val value: Boolean)

@JvmInline
@Serializable(with = StrictRemoteIntSerializer::class)
private value class StrictRemoteInt(val value: Int)

@JvmInline
@Serializable(with = StrictRemoteLongSerializer::class)
private value class StrictRemoteLong(val value: Long)

@Serializable
private enum class AiChatRoleWire {
    @SerialName("user") USER,
    @SerialName("assistant") ASSISTANT,
}

@Serializable
private enum class AiChatToolCallStatusWire {
    @SerialName("started") STARTED,
    @SerialName("completed") COMPLETED,
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
    val features: AiChatFeaturesWire,
    val liveUrl: StrictRemoteString? = null
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
    val chatConfig: AiChatServerConfigWire,
    val activeRun: AiChatActiveRunWire? = null
)

@Serializable
private data class AiChatAcceptedConversationEnvelopeWire(
    val accepted: StrictRemoteBoolean,
    val sessionId: StrictRemoteString,
    val conversationScopeId: StrictRemoteString,
    val conversation: AiChatConversationWire,
    val chatConfig: AiChatServerConfigWire,
    val activeRun: AiChatActiveRunWire? = null,
    val deduplicated: StrictRemoteBoolean? = null
)

@Serializable
private data class AiChatStopRunResponseWire(
    val sessionId: StrictRemoteString,
    val conversationScopeId: StrictRemoteString,
    val runId: StrictRemoteString? = null,
    val stopped: StrictRemoteBoolean,
    val stillRunning: StrictRemoteBoolean
)

@Serializable
private data class AiChatStreamPositionWire(
    val itemId: StrictRemoteString? = null
)

@Serializable
private sealed interface AiChatContentPartWire

@Serializable
@SerialName("text")
private data class AiChatTextContentPartWire(
    val text: StrictRemoteString
) : AiChatContentPartWire

@Serializable
@SerialName("reasoning_summary")
private data class AiChatReasoningSummaryContentPartWire(
    val reasoningId: StrictRemoteString? = null,
    val id: StrictRemoteString? = null,
    val streamPosition: AiChatStreamPositionWire? = null,
    val summary: StrictRemoteString,
    val status: AiChatToolCallStatusWire? = null
) : AiChatContentPartWire

@Serializable
@SerialName("image")
private data class AiChatImageContentPartWire(
    val fileName: StrictRemoteString? = null,
    val mediaType: StrictRemoteString,
    val base64Data: StrictRemoteString
) : AiChatContentPartWire

@Serializable
@SerialName("file")
private data class AiChatFileContentPartWire(
    val fileName: StrictRemoteString,
    val mediaType: StrictRemoteString,
    val base64Data: StrictRemoteString
) : AiChatContentPartWire

@Serializable
@SerialName("tool_call")
private data class AiChatToolCallContentPartWire(
    val toolCallId: StrictRemoteString? = null,
    val id: StrictRemoteString? = null,
    val name: StrictRemoteString,
    val status: AiChatToolCallStatusWire,
    val input: StrictRemoteString? = null,
    val output: StrictRemoteString? = null,
    val streamPosition: AiChatStreamPositionWire? = null
) : AiChatContentPartWire

@Serializable
private data class AiChatConversationMessageWire(
    val role: AiChatRoleWire,
    val content: List<AiChatContentPartWire>,
    val timestamp: StrictRemoteLong,
    val isError: StrictRemoteBoolean,
    val isStopped: StrictRemoteBoolean,
    val cursor: StrictRemoteString? = null,
    val itemId: StrictRemoteString? = null
)

@Serializable
private data class AiChatNewSessionWire(
    val sessionId: StrictRemoteString,
    val chatConfig: AiChatServerConfigWire
)

@Serializable
private data class AiChatTranscriptionWire(
    val text: StrictRemoteString,
    val sessionId: StrictRemoteString
)

@Serializable
private data class AiChatLiveEventTypeEnvelopeWire(
    val type: AiChatLiveEventTypeWire
)

@Serializable
private data class AiChatLiveUnknownEventTypeEnvelopeWire(
    val type: StrictRemoteString
)

@Serializable
private enum class AiChatLiveEventTypeWire {
    @SerialName("assistant_delta") ASSISTANT_DELTA,
    @SerialName("assistant_tool_call") ASSISTANT_TOOL_CALL,
    @SerialName("assistant_reasoning_started") ASSISTANT_REASONING_STARTED,
    @SerialName("assistant_reasoning_summary") ASSISTANT_REASONING_SUMMARY,
    @SerialName("assistant_reasoning_done") ASSISTANT_REASONING_DONE,
    @SerialName("assistant_message_done") ASSISTANT_MESSAGE_DONE,
    @SerialName("repair_status") REPAIR_STATUS,
    @SerialName("run_terminal") RUN_TERMINAL,
}

/**
 * Unknown live event types are forward-compatible extension points and must be
 * ignored. Known event types remain strict and still fail on invalid payloads.
 */
internal sealed interface AiChatLiveEventPayloadDecodeResult {
    data class Event(val event: AiChatLiveEvent) : AiChatLiveEventPayloadDecodeResult
    data class IgnoredUnknownType(val eventType: String) : AiChatLiveEventPayloadDecodeResult
}

@Serializable
private data class AiChatLiveEventMetadataWire(
    val sessionId: StrictRemoteString,
    val conversationScopeId: StrictRemoteString,
    val runId: StrictRemoteString,
    val cursor: StrictRemoteString? = null,
    val sequenceNumber: StrictRemoteInt,
    val streamEpoch: StrictRemoteString
)

@Serializable
private data class AiChatLiveAssistantDeltaWireEvent(
    val sessionId: StrictRemoteString,
    val conversationScopeId: StrictRemoteString,
    val runId: StrictRemoteString,
    val cursor: StrictRemoteString,
    val sequenceNumber: StrictRemoteInt,
    val streamEpoch: StrictRemoteString,
    val text: StrictRemoteString,
    val itemId: StrictRemoteString
)

@Serializable
private data class AiChatLiveAssistantToolCallWireEvent(
    val sessionId: StrictRemoteString,
    val conversationScopeId: StrictRemoteString,
    val runId: StrictRemoteString,
    val cursor: StrictRemoteString,
    val sequenceNumber: StrictRemoteInt,
    val streamEpoch: StrictRemoteString,
    val toolCallId: StrictRemoteString,
    val name: StrictRemoteString,
    val status: AiChatToolCallStatusWire,
    val input: StrictRemoteString? = null,
    val output: StrictRemoteString? = null,
    val providerStatus: StrictRemoteString? = null,
    val itemId: StrictRemoteString,
    val outputIndex: StrictRemoteInt
)

@Serializable
private data class AiChatLiveAssistantReasoningStartedWireEvent(
    val sessionId: StrictRemoteString,
    val conversationScopeId: StrictRemoteString,
    val runId: StrictRemoteString,
    val cursor: StrictRemoteString,
    val sequenceNumber: StrictRemoteInt,
    val streamEpoch: StrictRemoteString,
    val reasoningId: StrictRemoteString,
    val itemId: StrictRemoteString,
    val outputIndex: StrictRemoteInt
)

@Serializable
private data class AiChatLiveAssistantReasoningSummaryWireEvent(
    val sessionId: StrictRemoteString,
    val conversationScopeId: StrictRemoteString,
    val runId: StrictRemoteString,
    val cursor: StrictRemoteString,
    val sequenceNumber: StrictRemoteInt,
    val streamEpoch: StrictRemoteString,
    val reasoningId: StrictRemoteString,
    val summary: StrictRemoteString,
    val itemId: StrictRemoteString,
    val outputIndex: StrictRemoteInt
)

@Serializable
private data class AiChatLiveAssistantReasoningDoneWireEvent(
    val sessionId: StrictRemoteString,
    val conversationScopeId: StrictRemoteString,
    val runId: StrictRemoteString,
    val cursor: StrictRemoteString,
    val sequenceNumber: StrictRemoteInt,
    val streamEpoch: StrictRemoteString,
    val reasoningId: StrictRemoteString,
    val itemId: StrictRemoteString,
    val outputIndex: StrictRemoteInt
)

@Serializable
private data class AiChatLiveAssistantMessageDoneWireEvent(
    val sessionId: StrictRemoteString,
    val conversationScopeId: StrictRemoteString,
    val runId: StrictRemoteString,
    val cursor: StrictRemoteString,
    val sequenceNumber: StrictRemoteInt,
    val streamEpoch: StrictRemoteString,
    val itemId: StrictRemoteString,
    val content: List<AiChatContentPartWire>,
    val isError: StrictRemoteBoolean,
    val isStopped: StrictRemoteBoolean
)

@Serializable
private data class AiChatLiveRepairStatusWireEvent(
    val sessionId: StrictRemoteString,
    val conversationScopeId: StrictRemoteString,
    val runId: StrictRemoteString,
    val cursor: StrictRemoteString? = null,
    val sequenceNumber: StrictRemoteInt,
    val streamEpoch: StrictRemoteString,
    val message: StrictRemoteString,
    val attempt: StrictRemoteInt,
    val maxAttempts: StrictRemoteInt,
    val toolName: StrictRemoteString? = null
)

@Serializable
private enum class AiChatRunTerminalOutcomeWire {
    @SerialName("completed") COMPLETED,
    @SerialName("stopped") STOPPED,
    @SerialName("error") ERROR,
    @SerialName("reset_required") RESET_REQUIRED,
}

@Serializable
private data class AiChatLiveRunTerminalWireEvent(
    val sessionId: StrictRemoteString,
    val conversationScopeId: StrictRemoteString,
    val runId: StrictRemoteString,
    val cursor: StrictRemoteString? = null,
    val sequenceNumber: StrictRemoteInt,
    val streamEpoch: StrictRemoteString,
    val outcome: AiChatRunTerminalOutcomeWire,
    val message: StrictRemoteString? = null,
    val assistantItemId: StrictRemoteString? = null,
    val isError: StrictRemoteBoolean? = null,
    val isStopped: StrictRemoteBoolean? = null
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
        conversationScopeId = wire.conversationScopeId.value,
        runId = wire.runId?.value?.ifBlank { null },
        stopped = wire.stopped.value,
        stillRunning = wire.stillRunning.value
    )
}

internal fun decodeAiChatLiveEventPayload(eventType: String?, payload: String): AiChatLiveEvent? {
    return when (val decodingResult = decodeAiChatLiveEventPayloadResult(eventType = eventType, payload = payload)) {
        is AiChatLiveEventPayloadDecodeResult.Event -> decodingResult.event
        is AiChatLiveEventPayloadDecodeResult.IgnoredUnknownType -> null
    }
}

internal fun decodeAiChatLiveEventPayloadResult(
    eventType: String?,
    payload: String
): AiChatLiveEventPayloadDecodeResult {
    val resolvedType = if (eventType == null) {
        val rawType = decodeAiChatWire<AiChatLiveUnknownEventTypeEnvelopeWire>(
            payload = payload,
            context = "chat.live.event.type"
        ).type.value
        AiChatLiveEventTypeWire.entries.firstOrNull { candidate -> candidate.serialName == rawType }
            ?: return AiChatLiveEventPayloadDecodeResult.IgnoredUnknownType(eventType = rawType)
    } else {
        AiChatLiveEventTypeWire.entries.firstOrNull { candidate -> candidate.serialName == eventType }
            ?: return AiChatLiveEventPayloadDecodeResult.IgnoredUnknownType(eventType = eventType)
    }

    return when (resolvedType) {
        AiChatLiveEventTypeWire.ASSISTANT_DELTA -> {
            val wire = decodeAiChatWire<AiChatLiveAssistantDeltaWireEvent>(payload = payload, context = "chat.live.assistant_delta")
            AiChatLiveEventPayloadDecodeResult.Event(AiChatLiveEvent.AssistantDelta(
                metadata = wire.asMetadata(),
                text = wire.text.value,
                itemId = wire.itemId.value
            ))
        }
        AiChatLiveEventTypeWire.ASSISTANT_TOOL_CALL -> {
            val wire = decodeAiChatWire<AiChatLiveAssistantToolCallWireEvent>(payload = payload, context = "chat.live.assistant_tool_call")
            AiChatLiveEventPayloadDecodeResult.Event(AiChatLiveEvent.AssistantToolCall(
                metadata = wire.asMetadata(),
                toolCall = AiChatToolCall(
                    toolCallId = wire.toolCallId.value,
                    name = wire.name.value,
                    status = wire.status.asDomain(),
                    input = wire.input?.value?.ifBlank { null },
                    output = wire.output?.value?.ifBlank { null }
                ),
                itemId = wire.itemId.value,
                outputIndex = wire.outputIndex.value,
                providerStatus = wire.providerStatus?.value?.ifBlank { null }
            ))
        }
        AiChatLiveEventTypeWire.ASSISTANT_REASONING_STARTED -> {
            val wire = decodeAiChatWire<AiChatLiveAssistantReasoningStartedWireEvent>(payload = payload, context = "chat.live.assistant_reasoning_started")
            AiChatLiveEventPayloadDecodeResult.Event(AiChatLiveEvent.AssistantReasoningStarted(
                metadata = wire.asMetadata(),
                reasoningId = wire.reasoningId.value,
                itemId = wire.itemId.value,
                outputIndex = wire.outputIndex.value
            ))
        }
        AiChatLiveEventTypeWire.ASSISTANT_REASONING_SUMMARY -> {
            val wire = decodeAiChatWire<AiChatLiveAssistantReasoningSummaryWireEvent>(payload = payload, context = "chat.live.assistant_reasoning_summary")
            AiChatLiveEventPayloadDecodeResult.Event(AiChatLiveEvent.AssistantReasoningSummary(
                metadata = wire.asMetadata(),
                reasoningSummary = AiChatReasoningSummary(
                    reasoningId = wire.reasoningId.value,
                    summary = wire.summary.value,
                    status = AiChatToolCallStatus.STARTED
                ),
                itemId = wire.itemId.value,
                outputIndex = wire.outputIndex.value
            ))
        }
        AiChatLiveEventTypeWire.ASSISTANT_REASONING_DONE -> {
            val wire = decodeAiChatWire<AiChatLiveAssistantReasoningDoneWireEvent>(payload = payload, context = "chat.live.assistant_reasoning_done")
            AiChatLiveEventPayloadDecodeResult.Event(AiChatLiveEvent.AssistantReasoningDone(
                metadata = wire.asMetadata(),
                reasoningId = wire.reasoningId.value,
                itemId = wire.itemId.value,
                outputIndex = wire.outputIndex.value
            ))
        }
        AiChatLiveEventTypeWire.ASSISTANT_MESSAGE_DONE -> {
            val wire = decodeAiChatWire<AiChatLiveAssistantMessageDoneWireEvent>(payload = payload, context = "chat.live.assistant_message_done")
            AiChatLiveEventPayloadDecodeResult.Event(AiChatLiveEvent.AssistantMessageDone(
                metadata = wire.asMetadata(),
                itemId = wire.itemId.value,
                content = wire.content.map(::mapAiChatContentPart),
                isError = wire.isError.value,
                isStopped = wire.isStopped.value
            ))
        }
        AiChatLiveEventTypeWire.REPAIR_STATUS -> {
            val wire = decodeAiChatWire<AiChatLiveRepairStatusWireEvent>(payload = payload, context = "chat.live.repair_status")
            AiChatLiveEventPayloadDecodeResult.Event(AiChatLiveEvent.RepairStatus(
                metadata = wire.asMetadata(),
                status = AiChatRepairAttemptStatus(
                    message = wire.message.value,
                    attempt = wire.attempt.value,
                    maxAttempts = wire.maxAttempts.value,
                    toolName = wire.toolName?.value?.ifBlank { null }
                )
            ))
        }
        AiChatLiveEventTypeWire.RUN_TERMINAL -> {
            val wire = decodeAiChatWire<AiChatLiveRunTerminalWireEvent>(payload = payload, context = "chat.live.run_terminal")
            AiChatLiveEventPayloadDecodeResult.Event(AiChatLiveEvent.RunTerminal(
                metadata = wire.asMetadata(),
                outcome = wire.outcome.asDomain(),
                message = wire.message?.value?.ifBlank { null },
                assistantItemId = wire.assistantItemId?.value?.ifBlank { null },
                isError = wire.isError?.value,
                isStopped = wire.isStopped?.value
            ))
        }
    }
}

private inline fun <reified T> decodeAiChatWire(payload: String, context: String): T {
    return try {
        strictRemoteJson.decodeFromString<T>(payload)
    } catch (error: Throwable) {
        throw buildRemoteContractMismatch(context = context, rawBody = payload, error = error)
    }
}

private fun AiChatRoleWire.asDomain(): AiChatRole {
    return when (this) {
        AiChatRoleWire.USER -> AiChatRole.USER
        AiChatRoleWire.ASSISTANT -> AiChatRole.ASSISTANT
    }
}

private fun AiChatToolCallStatusWire.asDomain(): AiChatToolCallStatus {
    return when (this) {
        AiChatToolCallStatusWire.STARTED -> AiChatToolCallStatus.STARTED
        AiChatToolCallStatusWire.COMPLETED -> AiChatToolCallStatus.COMPLETED
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
        ),
        liveUrl = this.liveUrl?.value?.ifBlank { null }
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
    return AiChatMessage(
        messageId = cursor?.let { "$sessionId-$index-$it" } ?: "snapshot-$index",
        role = this.role.asDomain(),
        content = this.content.map(::mapAiChatContentPart),
        timestampMillis = this.timestamp.value,
        isError = this.isError.value,
        isStopped = this.isStopped.value,
        cursor = cursor,
        itemId = this.itemId?.value?.ifBlank { null } ?: this.content.firstNotNullOfOrNull(::extractAiChatItemId)
    )
}

private fun AiChatConversationWire.asDomain(sessionId: String): AiChatConversation {
    return AiChatConversation(
        messages = this.messages.mapIndexed { index, message -> message.asDomain(sessionId = sessionId, index = index) },
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
        chatConfig = this.chatConfig.asDomain(),
        activeRun = this.activeRun?.asDomain(),
        deduplicated = this.deduplicated?.value
    )
}

private fun mapAiChatContentPart(part: AiChatContentPartWire): AiChatContentPart {
    return when (part) {
        is AiChatTextContentPartWire -> AiChatContentPart.Text(text = part.text.value)
        is AiChatReasoningSummaryContentPartWire -> AiChatContentPart.ReasoningSummary(
            reasoningSummary = AiChatReasoningSummary(
                reasoningId = part.reasoningId?.value?.ifBlank { null }
                    ?: part.id?.value?.ifBlank { null }
                    ?: part.streamPosition?.itemId?.value?.ifBlank { null }
                    ?: throw CloudContractMismatchException(
                        "Cloud contract mismatch for chat.content.reasoning_summary: missing AI chat reasoning summary id"
                    ),
                summary = part.summary.value,
                status = part.status?.asDomain() ?: AiChatToolCallStatus.COMPLETED
            )
        )
        is AiChatImageContentPartWire -> AiChatContentPart.Image(
            fileName = part.fileName?.value?.ifBlank { null },
            mediaType = part.mediaType.value,
            base64Data = part.base64Data.value
        )
        is AiChatFileContentPartWire -> AiChatContentPart.File(
            fileName = part.fileName.value,
            mediaType = part.mediaType.value,
            base64Data = part.base64Data.value
        )
        is AiChatToolCallContentPartWire -> AiChatContentPart.ToolCall(
            toolCall = AiChatToolCall(
                toolCallId = part.toolCallId?.value?.ifBlank { null }
                    ?: part.id?.value?.ifBlank { null }
                    ?: throw CloudContractMismatchException(
                        "Cloud contract mismatch for chat.content.tool_call: missing AI chat tool call id"
                    ),
                name = part.name.value,
                status = part.status.asDomain(),
                input = part.input?.value?.ifBlank { null },
                output = part.output?.value?.ifBlank { null }
            )
        )
    }
}

private fun extractAiChatItemId(part: AiChatContentPartWire): String? {
    return when (part) {
        is AiChatReasoningSummaryContentPartWire -> part.streamPosition?.itemId?.value?.ifBlank { null }
        is AiChatToolCallContentPartWire -> part.streamPosition?.itemId?.value?.ifBlank { null }
        is AiChatFileContentPartWire,
        is AiChatImageContentPartWire,
        is AiChatTextContentPartWire -> null
    }
}

private fun AiChatRunTerminalOutcomeWire.asDomain(): AiChatRunTerminalOutcome {
    return when (this) {
        AiChatRunTerminalOutcomeWire.COMPLETED -> AiChatRunTerminalOutcome.COMPLETED
        AiChatRunTerminalOutcomeWire.STOPPED -> AiChatRunTerminalOutcome.STOPPED
        AiChatRunTerminalOutcomeWire.ERROR -> AiChatRunTerminalOutcome.ERROR
        AiChatRunTerminalOutcomeWire.RESET_REQUIRED -> AiChatRunTerminalOutcome.RESET_REQUIRED
    }
}

private fun AiChatLiveEventMetadataWire.asDomain(): AiChatLiveEventMetadata {
    return AiChatLiveEventMetadata(
        sessionId = this.sessionId.value,
        conversationScopeId = this.conversationScopeId.value,
        runId = this.runId.value,
        cursor = this.cursor?.value?.ifBlank { null },
        sequenceNumber = this.sequenceNumber.value,
        streamEpoch = this.streamEpoch.value
    )
}

private fun AiChatLiveAssistantDeltaWireEvent.asMetadata(): AiChatLiveEventMetadata {
    return AiChatLiveEventMetadataWire(
        sessionId = this.sessionId,
        conversationScopeId = this.conversationScopeId,
        runId = this.runId,
        cursor = this.cursor,
        sequenceNumber = this.sequenceNumber,
        streamEpoch = this.streamEpoch
    ).asDomain()
}

private fun AiChatLiveAssistantToolCallWireEvent.asMetadata(): AiChatLiveEventMetadata {
    return AiChatLiveEventMetadataWire(
        sessionId = this.sessionId,
        conversationScopeId = this.conversationScopeId,
        runId = this.runId,
        cursor = this.cursor,
        sequenceNumber = this.sequenceNumber,
        streamEpoch = this.streamEpoch
    ).asDomain()
}

private fun AiChatLiveAssistantReasoningStartedWireEvent.asMetadata(): AiChatLiveEventMetadata {
    return AiChatLiveEventMetadataWire(
        sessionId = this.sessionId,
        conversationScopeId = this.conversationScopeId,
        runId = this.runId,
        cursor = this.cursor,
        sequenceNumber = this.sequenceNumber,
        streamEpoch = this.streamEpoch
    ).asDomain()
}

private fun AiChatLiveAssistantReasoningSummaryWireEvent.asMetadata(): AiChatLiveEventMetadata {
    return AiChatLiveEventMetadataWire(
        sessionId = this.sessionId,
        conversationScopeId = this.conversationScopeId,
        runId = this.runId,
        cursor = this.cursor,
        sequenceNumber = this.sequenceNumber,
        streamEpoch = this.streamEpoch
    ).asDomain()
}

private fun AiChatLiveAssistantReasoningDoneWireEvent.asMetadata(): AiChatLiveEventMetadata {
    return AiChatLiveEventMetadataWire(
        sessionId = this.sessionId,
        conversationScopeId = this.conversationScopeId,
        runId = this.runId,
        cursor = this.cursor,
        sequenceNumber = this.sequenceNumber,
        streamEpoch = this.streamEpoch
    ).asDomain()
}

private fun AiChatLiveAssistantMessageDoneWireEvent.asMetadata(): AiChatLiveEventMetadata {
    return AiChatLiveEventMetadataWire(
        sessionId = this.sessionId,
        conversationScopeId = this.conversationScopeId,
        runId = this.runId,
        cursor = this.cursor,
        sequenceNumber = this.sequenceNumber,
        streamEpoch = this.streamEpoch
    ).asDomain()
}

private fun AiChatLiveRepairStatusWireEvent.asMetadata(): AiChatLiveEventMetadata {
    return AiChatLiveEventMetadataWire(
        sessionId = this.sessionId,
        conversationScopeId = this.conversationScopeId,
        runId = this.runId,
        cursor = this.cursor,
        sequenceNumber = this.sequenceNumber,
        streamEpoch = this.streamEpoch
    ).asDomain()
}

private fun AiChatLiveRunTerminalWireEvent.asMetadata(): AiChatLiveEventMetadata {
    return AiChatLiveEventMetadataWire(
        sessionId = this.sessionId,
        conversationScopeId = this.conversationScopeId,
        runId = this.runId,
        cursor = this.cursor,
        sequenceNumber = this.sequenceNumber,
        streamEpoch = this.streamEpoch
    ).asDomain()
}

private object StrictRemoteStringSerializer : KSerializer<StrictRemoteString> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor(serialName = "StrictRemoteString", kind = PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): StrictRemoteString {
        val primitive = decoder.requireRemotePrimitive(expectedType = "string")
        if (!primitive.isString) {
            throw CloudContractMismatchException("Cloud contract mismatch: expected JSON string but received ${describeRemotePrimitive(primitive)}")
        }
        return StrictRemoteString(primitive.content)
    }

    override fun serialize(encoder: Encoder, value: StrictRemoteString) {
        encoder.encodeString(value.value)
    }
}

private object StrictRemoteBooleanSerializer : KSerializer<StrictRemoteBoolean> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor(serialName = "StrictRemoteBoolean", kind = PrimitiveKind.BOOLEAN)

    override fun deserialize(decoder: Decoder): StrictRemoteBoolean {
        val primitive = decoder.requireRemotePrimitive(expectedType = "boolean")
        if (primitive.isString) {
            throw CloudContractMismatchException("Cloud contract mismatch: expected JSON boolean but received string")
        }
        val value = primitive.booleanOrNull
            ?: throw CloudContractMismatchException("Cloud contract mismatch: expected JSON boolean but received ${describeRemotePrimitive(primitive)}")
        return StrictRemoteBoolean(value)
    }

    override fun serialize(encoder: Encoder, value: StrictRemoteBoolean) {
        encoder.encodeBoolean(value.value)
    }
}

private object StrictRemoteIntSerializer : KSerializer<StrictRemoteInt> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor(serialName = "StrictRemoteInt", kind = PrimitiveKind.INT)

    override fun deserialize(decoder: Decoder): StrictRemoteInt {
        val primitive = decoder.requireRemotePrimitive(expectedType = "integer")
        if (primitive.isString) {
            throw CloudContractMismatchException("Cloud contract mismatch: expected JSON integer but received string")
        }
        val value = primitive.intOrNull
            ?: throw CloudContractMismatchException("Cloud contract mismatch: expected JSON integer but received ${describeRemotePrimitive(primitive)}")
        return StrictRemoteInt(value)
    }

    override fun serialize(encoder: Encoder, value: StrictRemoteInt) {
        encoder.encodeInt(value.value)
    }
}

private object StrictRemoteLongSerializer : KSerializer<StrictRemoteLong> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor(serialName = "StrictRemoteLong", kind = PrimitiveKind.LONG)

    override fun deserialize(decoder: Decoder): StrictRemoteLong {
        val primitive = decoder.requireRemotePrimitive(expectedType = "long")
        if (primitive.isString) {
            throw CloudContractMismatchException("Cloud contract mismatch: expected JSON integer but received string")
        }
        val value = primitive.longOrNull
            ?: throw CloudContractMismatchException("Cloud contract mismatch: expected JSON integer but received ${describeRemotePrimitive(primitive)}")
        return StrictRemoteLong(value)
    }

    override fun serialize(encoder: Encoder, value: StrictRemoteLong) {
        encoder.encodeLong(value.value)
    }
}

private fun Decoder.requireRemotePrimitive(expectedType: String): JsonPrimitive {
    val jsonDecoder = this as? JsonDecoder
        ?: throw CloudContractMismatchException("Cloud contract mismatch: expected JSON decoder for $expectedType")
    val element = jsonDecoder.decodeJsonElement()
    return element as? JsonPrimitive
        ?: throw CloudContractMismatchException("Cloud contract mismatch: expected JSON $expectedType but received ${element::class.simpleName ?: "non-primitive"}")
}

private fun describeRemotePrimitive(primitive: JsonPrimitive): String {
    return when {
        primitive.isString -> "string"
        primitive.booleanOrNull != null -> "boolean"
        primitive.longOrNull != null -> "number"
        primitive.contentOrNull == null -> "null"
        else -> "primitive"
    }
}

private val AiChatLiveEventTypeWire.serialName: String
    get() = when (this) {
        AiChatLiveEventTypeWire.ASSISTANT_DELTA -> "assistant_delta"
        AiChatLiveEventTypeWire.ASSISTANT_TOOL_CALL -> "assistant_tool_call"
        AiChatLiveEventTypeWire.ASSISTANT_REASONING_STARTED -> "assistant_reasoning_started"
        AiChatLiveEventTypeWire.ASSISTANT_REASONING_SUMMARY -> "assistant_reasoning_summary"
        AiChatLiveEventTypeWire.ASSISTANT_REASONING_DONE -> "assistant_reasoning_done"
        AiChatLiveEventTypeWire.ASSISTANT_MESSAGE_DONE -> "assistant_message_done"
        AiChatLiveEventTypeWire.REPAIR_STATUS -> "repair_status"
        AiChatLiveEventTypeWire.RUN_TERMINAL -> "run_terminal"
    }
