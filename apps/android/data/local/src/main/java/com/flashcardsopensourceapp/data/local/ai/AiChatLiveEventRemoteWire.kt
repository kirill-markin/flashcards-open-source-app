package com.flashcardsopensourceapp.data.local.ai

import com.flashcardsopensourceapp.data.local.model.AiChatLiveEvent
import com.flashcardsopensourceapp.data.local.model.AiChatLiveEventMetadata
import com.flashcardsopensourceapp.data.local.model.AiChatReasoningSummary
import com.flashcardsopensourceapp.data.local.model.AiChatRepairAttemptStatus
import com.flashcardsopensourceapp.data.local.model.AiChatRunTerminalOutcome
import com.flashcardsopensourceapp.data.local.model.AiChatToolCall
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

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
    @SerialName("composer_suggestions_updated") COMPOSER_SUGGESTIONS_UPDATED,
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
    val content: List<JsonObject>,
    val isError: StrictRemoteBoolean,
    val isStopped: StrictRemoteBoolean
)

@Serializable
private data class AiChatLiveComposerSuggestionsUpdatedWireEvent(
    val sessionId: StrictRemoteString,
    val conversationScopeId: StrictRemoteString,
    val runId: StrictRemoteString,
    val cursor: StrictRemoteString? = null,
    val sequenceNumber: StrictRemoteInt,
    val streamEpoch: StrictRemoteString,
    val suggestions: List<AiChatComposerSuggestionWire> = emptyList()
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
            val wire = decodeAiChatWire<AiChatLiveAssistantDeltaWireEvent>(
                payload = payload,
                context = "chat.live.assistant_delta"
            )
            AiChatLiveEventPayloadDecodeResult.Event(
                AiChatLiveEvent.AssistantDelta(
                    metadata = wire.asMetadata(),
                    text = wire.text.value,
                    itemId = wire.itemId.value
                )
            )
        }

        AiChatLiveEventTypeWire.ASSISTANT_TOOL_CALL -> {
            val wire = decodeAiChatWire<AiChatLiveAssistantToolCallWireEvent>(
                payload = payload,
                context = "chat.live.assistant_tool_call"
            )
            AiChatLiveEventPayloadDecodeResult.Event(
                AiChatLiveEvent.AssistantToolCall(
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
                )
            )
        }

        AiChatLiveEventTypeWire.ASSISTANT_REASONING_STARTED -> {
            val wire = decodeAiChatWire<AiChatLiveAssistantReasoningStartedWireEvent>(
                payload = payload,
                context = "chat.live.assistant_reasoning_started"
            )
            AiChatLiveEventPayloadDecodeResult.Event(
                AiChatLiveEvent.AssistantReasoningStarted(
                    metadata = wire.asMetadata(),
                    reasoningId = wire.reasoningId.value,
                    itemId = wire.itemId.value,
                    outputIndex = wire.outputIndex.value
                )
            )
        }

        AiChatLiveEventTypeWire.ASSISTANT_REASONING_SUMMARY -> {
            val wire = decodeAiChatWire<AiChatLiveAssistantReasoningSummaryWireEvent>(
                payload = payload,
                context = "chat.live.assistant_reasoning_summary"
            )
            AiChatLiveEventPayloadDecodeResult.Event(
                AiChatLiveEvent.AssistantReasoningSummary(
                    metadata = wire.asMetadata(),
                    reasoningSummary = AiChatReasoningSummary(
                        reasoningId = wire.reasoningId.value,
                        summary = wire.summary.value,
                        status = AiChatToolCallStatus.STARTED
                    ),
                    itemId = wire.itemId.value,
                    outputIndex = wire.outputIndex.value
                )
            )
        }

        AiChatLiveEventTypeWire.ASSISTANT_REASONING_DONE -> {
            val wire = decodeAiChatWire<AiChatLiveAssistantReasoningDoneWireEvent>(
                payload = payload,
                context = "chat.live.assistant_reasoning_done"
            )
            AiChatLiveEventPayloadDecodeResult.Event(
                AiChatLiveEvent.AssistantReasoningDone(
                    metadata = wire.asMetadata(),
                    reasoningId = wire.reasoningId.value,
                    itemId = wire.itemId.value,
                    outputIndex = wire.outputIndex.value
                )
            )
        }

        AiChatLiveEventTypeWire.ASSISTANT_MESSAGE_DONE -> {
            val wire = decodeAiChatWire<AiChatLiveAssistantMessageDoneWireEvent>(
                payload = payload,
                context = "chat.live.assistant_message_done"
            )
            AiChatLiveEventPayloadDecodeResult.Event(
                AiChatLiveEvent.AssistantMessageDone(
                    metadata = wire.asMetadata(),
                    itemId = wire.itemId.value,
                    content = wire.content.map { part ->
                        mapAiChatContentPart(
                            part = part,
                            sessionId = wire.sessionId.value,
                            messageId = wire.itemId.value,
                            source = "live"
                        )
                    },
                    isError = wire.isError.value,
                    isStopped = wire.isStopped.value
                )
            )
        }

        AiChatLiveEventTypeWire.COMPOSER_SUGGESTIONS_UPDATED -> {
            val wire = decodeAiChatWire<AiChatLiveComposerSuggestionsUpdatedWireEvent>(
                payload = payload,
                context = "chat.live.composer_suggestions_updated"
            )
            AiChatLiveEventPayloadDecodeResult.Event(
                AiChatLiveEvent.ComposerSuggestionsUpdated(
                    metadata = wire.asMetadata(),
                    suggestions = wire.suggestions.map(AiChatComposerSuggestionWire::asDomain)
                )
            )
        }

        AiChatLiveEventTypeWire.REPAIR_STATUS -> {
            val wire = decodeAiChatWire<AiChatLiveRepairStatusWireEvent>(
                payload = payload,
                context = "chat.live.repair_status"
            )
            AiChatLiveEventPayloadDecodeResult.Event(
                AiChatLiveEvent.RepairStatus(
                    metadata = wire.asMetadata(),
                    status = AiChatRepairAttemptStatus(
                        message = wire.message.value,
                        attempt = wire.attempt.value,
                        maxAttempts = wire.maxAttempts.value,
                        toolName = wire.toolName?.value?.ifBlank { null }
                    )
                )
            )
        }

        AiChatLiveEventTypeWire.RUN_TERMINAL -> {
            val wire = decodeAiChatWire<AiChatLiveRunTerminalWireEvent>(
                payload = payload,
                context = "chat.live.run_terminal"
            )
            AiChatLiveEventPayloadDecodeResult.Event(
                AiChatLiveEvent.RunTerminal(
                    metadata = wire.asMetadata(),
                    outcome = wire.outcome.asDomain(),
                    message = wire.message?.value?.ifBlank { null },
                    assistantItemId = wire.assistantItemId?.value?.ifBlank { null },
                    isError = wire.isError?.value,
                    isStopped = wire.isStopped?.value
                )
            )
        }
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

private fun AiChatLiveComposerSuggestionsUpdatedWireEvent.asMetadata(): AiChatLiveEventMetadata {
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

private val AiChatLiveEventTypeWire.serialName: String
    get() = when (this) {
        AiChatLiveEventTypeWire.ASSISTANT_DELTA -> "assistant_delta"
        AiChatLiveEventTypeWire.ASSISTANT_TOOL_CALL -> "assistant_tool_call"
        AiChatLiveEventTypeWire.ASSISTANT_REASONING_STARTED -> "assistant_reasoning_started"
        AiChatLiveEventTypeWire.ASSISTANT_REASONING_SUMMARY -> "assistant_reasoning_summary"
        AiChatLiveEventTypeWire.ASSISTANT_REASONING_DONE -> "assistant_reasoning_done"
        AiChatLiveEventTypeWire.ASSISTANT_MESSAGE_DONE -> "assistant_message_done"
        AiChatLiveEventTypeWire.COMPOSER_SUGGESTIONS_UPDATED -> "composer_suggestions_updated"
        AiChatLiveEventTypeWire.REPAIR_STATUS -> "repair_status"
        AiChatLiveEventTypeWire.RUN_TERMINAL -> "run_terminal"
    }
