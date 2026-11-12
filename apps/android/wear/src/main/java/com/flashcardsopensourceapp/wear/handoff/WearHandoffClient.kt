package com.flashcardsopensourceapp.wear.handoff

import android.content.Context
import com.flashcardsopensourceapp.data.local.watch.WatchHandoffPhoneReplyFailedException
import com.flashcardsopensourceapp.data.local.watch.WatchHandoffReply
import com.flashcardsopensourceapp.data.local.watch.WatchHandoffRequest
import com.flashcardsopensourceapp.data.local.watch.WatchHandoffUnsupportedContractVersionException
import com.flashcardsopensourceapp.data.local.watch.decodeWatchHandoffReply
import com.flashcardsopensourceapp.data.local.watch.encodeWatchHandoffRequest
import com.flashcardsopensourceapp.data.local.watch.watchHandoffCapabilityName
import com.flashcardsopensourceapp.data.local.watch.watchHandoffContractVersion
import com.flashcardsopensourceapp.data.local.watch.watchHandoffRpcPath
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.Node
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableStatusCodes
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The Data Layer never times out a request the phone app does not answer, for example a phone app
 * without the responder, so the watch bounds the wait itself.
 */
private const val wearHandoffReplyTimeoutSeconds: Int = 20

class WearHandoffPhoneUnreachableException(
    detail: String
) : IllegalStateException("The paired phone is not reachable: $detail")

class WearHandoffReplyTimedOutException(
    seconds: Int
) : IllegalStateException("The phone app did not answer the watch handoff request within $seconds seconds")

class WearHandoffRequestFailedException(
    stage: String,
    statusCode: Int,
    statusMessage: String?
) : IllegalStateException(
    "Watch handoff request failed at stage=$stage: statusCode=$statusCode statusMessage=$statusMessage"
)

/** The reply carries tokens, so the error names only the payload size and the decoder's error type, never values. */
class WearHandoffReplyDecodingFailedException(
    payloadSizeBytes: Int,
    decodingErrorType: String
) : IllegalArgumentException(
    "Watch handoff reply could not be decoded: payloadSizeBytes=$payloadSizeBytes decodingErrorType=$decodingErrorType"
)

/** Asks the phone node advertising the handoff capability for the account its app holds. */
class WearHandoffClient(context: Context) {
    private val capabilityClient: CapabilityClient = Wearable.getCapabilityClient(context)
    private val messageClient = Wearable.getMessageClient(context)

    /**
     * Throws [WearHandoffPhoneUnreachableException], [WearHandoffReplyTimedOutException],
     * [WearHandoffRequestFailedException], [WatchHandoffPhoneReplyFailedException],
     * [WatchHandoffUnsupportedContractVersionException] or [WearHandoffReplyDecodingFailedException].
     */
    suspend fun requestHandoff(): WatchHandoffReply {
        val payload = withTimeoutOrNull(timeMillis = wearHandoffReplyTimeoutSeconds * 1_000L) {
            val phoneNode = findReachablePhoneNode()
            sendHandoffRequest(phoneNode = phoneNode)
        } ?: throw WearHandoffReplyTimedOutException(seconds = wearHandoffReplyTimeoutSeconds)
        return decodeHandoffReply(payload = payload)
    }

    private suspend fun findReachablePhoneNode(): Node {
        val capabilityInfo = try {
            capabilityClient.getCapability(watchHandoffCapabilityName, CapabilityClient.FILTER_REACHABLE).await()
        } catch (error: ApiException) {
            throw WearHandoffRequestFailedException(
                stage = "capability_lookup",
                statusCode = error.statusCode,
                statusMessage = error.status.statusMessage
            )
        }
        val nodes = capabilityInfo.nodes
        return nodes.firstOrNull(Node::isNearby)
            ?: nodes.firstOrNull()
            ?: throw WearHandoffPhoneUnreachableException(
                detail = "no reachable node advertises capability \"$watchHandoffCapabilityName\""
            )
    }

    private suspend fun sendHandoffRequest(phoneNode: Node): ByteArray {
        val request = encodeWatchHandoffRequest(
            request = WatchHandoffRequest(contractVersion = watchHandoffContractVersion)
        )
        try {
            return messageClient.sendRequest(phoneNode.id, watchHandoffRpcPath, request).await()
        } catch (error: ApiException) {
            if (error.statusCode == WearableStatusCodes.TARGET_NODE_NOT_CONNECTED) {
                throw WearHandoffPhoneUnreachableException(detail = "node ${phoneNode.id} disconnected during the request")
            }
            throw WearHandoffRequestFailedException(
                stage = "send_request",
                statusCode = error.statusCode,
                statusMessage = error.status.statusMessage
            )
        }
    }
}

private fun decodeHandoffReply(payload: ByteArray): WatchHandoffReply {
    try {
        return decodeWatchHandoffReply(payload = payload)
    } catch (error: WatchHandoffUnsupportedContractVersionException) {
        throw error
    } catch (error: IllegalArgumentException) {
        throw WearHandoffReplyDecodingFailedException(
            payloadSizeBytes = payload.size,
            decodingErrorType = error::class.java.name
        )
    }
}
