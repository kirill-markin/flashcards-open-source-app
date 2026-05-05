package com.flashcardsopensourceapp.data.local.ai

import com.flashcardsopensourceapp.data.local.cloud.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.cloud.buildRemoteContractMismatch
import com.flashcardsopensourceapp.data.local.cloud.strictRemoteJson
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
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
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull

@JvmInline
@Serializable(with = StrictRemoteStringSerializer::class)
internal value class StrictRemoteString(val value: String)

@JvmInline
@Serializable(with = StrictRemoteBooleanSerializer::class)
internal value class StrictRemoteBoolean(val value: Boolean)

@JvmInline
@Serializable(with = StrictRemoteIntSerializer::class)
internal value class StrictRemoteInt(val value: Int)

@JvmInline
@Serializable(with = StrictRemoteLongSerializer::class)
internal value class StrictRemoteLong(val value: Long)

@Serializable
internal enum class AiChatToolCallStatusWire {
    @SerialName("started") STARTED,
    @SerialName("completed") COMPLETED,
}

internal inline fun <reified T> decodeAiChatWire(payload: String, context: String): T {
    return try {
        strictRemoteJson.decodeFromString<T>(payload)
    } catch (error: Throwable) {
        throw buildRemoteContractMismatch(context = context, rawBody = payload, error = error)
    }
}

internal inline fun <reified T> decodeAiChatWireElement(element: JsonElement, context: String): T {
    return try {
        strictRemoteJson.decodeFromJsonElement<T>(element)
    } catch (error: Throwable) {
        throw buildRemoteContractMismatch(context = context, rawBody = element.toString(), error = error)
    }
}

internal fun AiChatToolCallStatusWire.asDomain(): AiChatToolCallStatus {
    return when (this) {
        AiChatToolCallStatusWire.STARTED -> AiChatToolCallStatus.STARTED
        AiChatToolCallStatusWire.COMPLETED -> AiChatToolCallStatus.COMPLETED
    }
}

internal object StrictRemoteStringSerializer : KSerializer<StrictRemoteString> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor(serialName = "StrictRemoteString", kind = PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): StrictRemoteString {
        val primitive = decoder.requireRemotePrimitive(expectedType = "string")
        if (!primitive.isString) {
            throw CloudContractMismatchException(
                "Cloud contract mismatch: expected JSON string but received ${describeRemotePrimitive(primitive)}"
            )
        }
        return StrictRemoteString(primitive.content)
    }

    override fun serialize(encoder: Encoder, value: StrictRemoteString) {
        encoder.encodeString(value.value)
    }
}

internal object StrictRemoteBooleanSerializer : KSerializer<StrictRemoteBoolean> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor(serialName = "StrictRemoteBoolean", kind = PrimitiveKind.BOOLEAN)

    override fun deserialize(decoder: Decoder): StrictRemoteBoolean {
        val primitive = decoder.requireRemotePrimitive(expectedType = "boolean")
        if (primitive.isString) {
            throw CloudContractMismatchException("Cloud contract mismatch: expected JSON boolean but received string")
        }
        val value = primitive.booleanOrNull
            ?: throw CloudContractMismatchException(
                "Cloud contract mismatch: expected JSON boolean but received ${describeRemotePrimitive(primitive)}"
            )
        return StrictRemoteBoolean(value)
    }

    override fun serialize(encoder: Encoder, value: StrictRemoteBoolean) {
        encoder.encodeBoolean(value.value)
    }
}

internal object StrictRemoteIntSerializer : KSerializer<StrictRemoteInt> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor(serialName = "StrictRemoteInt", kind = PrimitiveKind.INT)

    override fun deserialize(decoder: Decoder): StrictRemoteInt {
        val primitive = decoder.requireRemotePrimitive(expectedType = "integer")
        if (primitive.isString) {
            throw CloudContractMismatchException("Cloud contract mismatch: expected JSON integer but received string")
        }
        val value = primitive.intOrNull
            ?: throw CloudContractMismatchException(
                "Cloud contract mismatch: expected JSON integer but received ${describeRemotePrimitive(primitive)}"
            )
        return StrictRemoteInt(value)
    }

    override fun serialize(encoder: Encoder, value: StrictRemoteInt) {
        encoder.encodeInt(value.value)
    }
}

internal object StrictRemoteLongSerializer : KSerializer<StrictRemoteLong> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor(serialName = "StrictRemoteLong", kind = PrimitiveKind.LONG)

    override fun deserialize(decoder: Decoder): StrictRemoteLong {
        val primitive = decoder.requireRemotePrimitive(expectedType = "long")
        if (primitive.isString) {
            throw CloudContractMismatchException("Cloud contract mismatch: expected JSON integer but received string")
        }
        val value = primitive.longOrNull
            ?: throw CloudContractMismatchException(
                "Cloud contract mismatch: expected JSON integer but received ${describeRemotePrimitive(primitive)}"
            )
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
        ?: throw CloudContractMismatchException(
            "Cloud contract mismatch: expected JSON $expectedType but received ${element::class.simpleName ?: "non-primitive"}"
        )
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
