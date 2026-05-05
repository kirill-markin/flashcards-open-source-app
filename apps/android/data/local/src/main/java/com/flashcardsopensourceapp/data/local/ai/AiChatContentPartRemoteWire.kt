package com.flashcardsopensourceapp.data.local.ai

import com.flashcardsopensourceapp.data.local.cloud.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatReasoningSummary
import com.flashcardsopensourceapp.data.local.model.AiChatToolCall
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

@Serializable
private data class AiChatStreamPositionWire(
    val itemId: StrictRemoteString? = null
)

@Serializable
@SerialName("text")
private data class AiChatTextContentPartWire(
    val text: StrictRemoteString
)

@Serializable
@SerialName("reasoning_summary")
private data class AiChatReasoningSummaryContentPartWire(
    val reasoningId: StrictRemoteString? = null,
    val id: StrictRemoteString? = null,
    val streamPosition: AiChatStreamPositionWire? = null,
    val summary: StrictRemoteString,
    val status: AiChatToolCallStatusWire? = null
)

@Serializable
@SerialName("image")
private data class AiChatImageContentPartWire(
    val fileName: StrictRemoteString? = null,
    val mediaType: StrictRemoteString,
    val base64Data: StrictRemoteString
)

@Serializable
@SerialName("file")
private data class AiChatFileContentPartWire(
    val fileName: StrictRemoteString,
    val mediaType: StrictRemoteString,
    val base64Data: StrictRemoteString
)

@Serializable
@SerialName("card")
private data class AiChatCardContentPartWire(
    val cardId: StrictRemoteString,
    val frontText: StrictRemoteString,
    val backText: StrictRemoteString,
    val tags: List<StrictRemoteString>,
    val effortLevel: StrictRemoteString
)

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
)

internal fun mapAiChatContentPart(
    part: JsonObject,
    sessionId: String,
    messageId: String,
    source: String
): AiChatContentPart {
    val originalType = part["type"]?.jsonPrimitive?.contentOrNull?.ifBlank { null }
        ?: throw CloudContractMismatchException(
            "Cloud contract mismatch for chat.content.type: missing AI chat content type"
        )

    return when (originalType) {
        "text" -> {
            val wire = decodeAiChatWireElement<AiChatTextContentPartWire>(element = part, context = "chat.content.text")
            AiChatContentPart.Text(text = wire.text.value)
        }

        "reasoning_summary" -> {
            val wire = decodeAiChatWireElement<AiChatReasoningSummaryContentPartWire>(
                element = part,
                context = "chat.content.reasoning_summary"
            )
            AiChatContentPart.ReasoningSummary(
                reasoningSummary = AiChatReasoningSummary(
                    reasoningId = wire.reasoningId?.value?.ifBlank { null }
                        ?: wire.id?.value?.ifBlank { null }
                        ?: wire.streamPosition?.itemId?.value?.ifBlank { null }
                        ?: throw CloudContractMismatchException(
                            "Cloud contract mismatch for chat.content.reasoning_summary: missing AI chat reasoning summary id"
                        ),
                    summary = wire.summary.value,
                    status = wire.status?.asDomain() ?: AiChatToolCallStatus.COMPLETED
                )
            )
        }

        "image" -> {
            val wire = decodeAiChatWireElement<AiChatImageContentPartWire>(element = part, context = "chat.content.image")
            AiChatContentPart.Image(
                fileName = wire.fileName?.value?.ifBlank { null },
                mediaType = wire.mediaType.value,
                base64Data = wire.base64Data.value
            )
        }

        "file" -> {
            val wire = decodeAiChatWireElement<AiChatFileContentPartWire>(element = part, context = "chat.content.file")
            AiChatContentPart.File(
                fileName = wire.fileName.value,
                mediaType = wire.mediaType.value,
                base64Data = wire.base64Data.value
            )
        }

        "card" -> {
            val wire = decodeAiChatWireElement<AiChatCardContentPartWire>(element = part, context = "chat.content.card")
            AiChatContentPart.Card(
                cardId = wire.cardId.value,
                frontText = wire.frontText.value,
                backText = wire.backText.value,
                tags = wire.tags.map(StrictRemoteString::value),
                effortLevel = wire.effortLevel.value.toEffortLevel()
            )
        }

        "tool_call" -> {
            val wire = decodeAiChatWireElement<AiChatToolCallContentPartWire>(element = part, context = "chat.content.tool_call")
            AiChatContentPart.ToolCall(
                toolCall = AiChatToolCall(
                    toolCallId = wire.toolCallId?.value?.ifBlank { null }
                        ?: wire.id?.value?.ifBlank { null }
                        ?: throw CloudContractMismatchException(
                            "Cloud contract mismatch for chat.content.tool_call: missing AI chat tool call id"
                        ),
                    name = wire.name.value,
                    status = wire.status.asDomain(),
                    input = wire.input?.value?.ifBlank { null },
                    output = wire.output?.value?.ifBlank { null }
                )
            )
        }

        else -> {
            AiChatDiagnosticsLogger.logUnknownContentReceived(
                originalType = originalType,
                sessionId = sessionId,
                messageId = messageId,
                source = source
            )
            AiChatContentPart.Unknown(
                originalType = originalType,
                summaryText = "Unsupported content",
                rawPayloadJson = part.toString()
            )
        }
    }
}

internal fun extractAiChatItemId(part: JsonObject): String? {
    return (part["streamPosition"] as? JsonObject)
        ?.get("itemId")
        ?.jsonPrimitive
        ?.contentOrNull
        ?.ifBlank { null }
}

private fun String.toEffortLevel(): EffortLevel {
    return when (this) {
        "fast" -> EffortLevel.FAST
        "medium" -> EffortLevel.MEDIUM
        "long" -> EffortLevel.LONG
        else -> throw CloudContractMismatchException(
            "Cloud contract mismatch for chat.content.card.effortLevel: unsupported effort level"
        )
    }
}
