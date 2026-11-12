package com.flashcardsopensourceapp.data.local.watch

import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.data.local.review.decodePersistedReviewFilter
import com.flashcardsopensourceapp.data.local.review.encodePersistedReviewFilter
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/*
 The watch never signs in on its own: it sends a Wearable Data Layer RPC on `watchHandoffRpcPath` to the
 phone node advertising `watchHandoffCapabilityName` and receives the account the phone app holds. Build
 and read RPC payloads only through the functions below. The watch and the phone ship together, so a
 payload of a different contract version is rejected rather than interpreted.
 */

const val watchHandoffContractVersion: Int = 1
const val watchHandoffCapabilityName: String = "nibomo_watch_handoff"
const val watchHandoffRpcPath: String = "/nibomo/watch-handoff"

class WatchHandoffUnsupportedContractVersionException(
    received: Int,
    supported: Int
) : IllegalArgumentException(
    "Watch handoff contract version $received is not supported; this build speaks version $supported"
)

class WatchHandoffPhoneReplyFailedException : IllegalStateException(
    "The phone could not build a watch handoff reply"
)

@Serializable
data class WatchHandoffRequest(
    val contractVersion: Int
)

/** The linked account the phone app is signed in to, with the workspace and Review filter it shows. */
@Serializable
data class WatchHandoffSignedInAccount(
    val credentials: StoredCloudCredentials,
    val linkedUserId: String,
    val email: String?,
    val workspaceId: String,
    @Serializable(with = PersistedReviewFilterSerializer::class)
    val reviewFilter: ReviewFilter
)

/** `SignedOut` covers a phone app that is signed out or is a guest: the watch serves linked accounts only. */
sealed interface WatchHandoffReply {
    data class SignedIn(
        val account: WatchHandoffSignedInAccount
    ) : WatchHandoffReply

    data object SignedOut : WatchHandoffReply
}

@Serializable
private data class WatchHandoffContractEnvelope(
    val contractVersion: Int
)

@Serializable
private enum class WatchHandoffReplyState {
    @SerialName("signedIn")
    SIGNED_IN,

    @SerialName("signedOut")
    SIGNED_OUT
}

@Serializable
private data class WatchHandoffReplyPayload(
    val contractVersion: Int,
    val state: WatchHandoffReplyState,
    val account: WatchHandoffSignedInAccount?
)

/** The review filter travels as the same JSON object `ReviewPreferencesStore` persists. */
internal object PersistedReviewFilterSerializer : KSerializer<ReviewFilter> {
    override val descriptor: SerialDescriptor = JsonObject.serializer().descriptor

    override fun serialize(encoder: Encoder, value: ReviewFilter) {
        encoder.encodeSerializableValue(
            JsonObject.serializer(),
            watchHandoffJson.parseToJsonElement(encodePersistedReviewFilter(reviewFilter = value)).jsonObject
        )
    }

    override fun deserialize(decoder: Decoder): ReviewFilter {
        return decodePersistedReviewFilter(
            rawValue = decoder.decodeSerializableValue(JsonObject.serializer()).toString()
        )
    }
}

private val watchHandoffJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}

fun encodeWatchHandoffRequest(request: WatchHandoffRequest): ByteArray {
    return watchHandoffJson.encodeToString(WatchHandoffRequest.serializer(), request).encodeToByteArray()
}

fun decodeWatchHandoffRequest(payload: ByteArray): WatchHandoffRequest {
    val text = payload.decodeToString()
    requireSupportedWatchHandoffContractVersion(text = text)
    return watchHandoffJson.decodeFromString(WatchHandoffRequest.serializer(), text)
}

fun encodeWatchHandoffReply(reply: WatchHandoffReply): ByteArray {
    val payload = when (reply) {
        is WatchHandoffReply.SignedIn -> WatchHandoffReplyPayload(
            contractVersion = watchHandoffContractVersion,
            state = WatchHandoffReplyState.SIGNED_IN,
            account = reply.account
        )

        WatchHandoffReply.SignedOut -> WatchHandoffReplyPayload(
            contractVersion = watchHandoffContractVersion,
            state = WatchHandoffReplyState.SIGNED_OUT,
            account = null
        )
    }
    return watchHandoffJson.encodeToString(WatchHandoffReplyPayload.serializer(), payload).encodeToByteArray()
}

/**
 * Sent when the phone cannot build a reply, including for a request of another contract version, so the
 * watch fails at once instead of waiting for a timeout.
 */
fun makeWatchHandoffFailureReply(): ByteArray {
    return ByteArray(size = 0)
}

fun decodeWatchHandoffReply(payload: ByteArray): WatchHandoffReply {
    if (payload.isEmpty()) {
        throw WatchHandoffPhoneReplyFailedException()
    }
    val text = payload.decodeToString()
    requireSupportedWatchHandoffContractVersion(text = text)
    val decoded = watchHandoffJson.decodeFromString(WatchHandoffReplyPayload.serializer(), text)
    return when (decoded.state) {
        WatchHandoffReplyState.SIGNED_IN -> WatchHandoffReply.SignedIn(
            account = requireNotNull(decoded.account) {
                "Watch handoff reply is signedIn but carries no account."
            }
        )

        WatchHandoffReplyState.SIGNED_OUT -> WatchHandoffReply.SignedOut
    }
}

private fun requireSupportedWatchHandoffContractVersion(text: String) {
    val envelope = watchHandoffJson.decodeFromString(WatchHandoffContractEnvelope.serializer(), text)
    if (envelope.contractVersion != watchHandoffContractVersion) {
        throw WatchHandoffUnsupportedContractVersionException(
            received = envelope.contractVersion,
            supported = watchHandoffContractVersion
        )
    }
}
