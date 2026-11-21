package com.flashcardsopensourceapp.wear.handoff

import android.content.Context
import android.content.Intent
import androidx.concurrent.futures.await
import androidx.core.net.toUri
import androidx.wear.phone.interactions.PhoneTypeHelper
import androidx.wear.remote.interactions.RemoteActivityHelper
import com.flashcardsopensourceapp.data.local.watch.WatchHandoffReply
import com.flashcardsopensourceapp.data.local.watch.WatchHandoffRequest
import com.flashcardsopensourceapp.data.local.watch.WatchHandoffUnsupportedContractVersionException
import com.flashcardsopensourceapp.data.local.watch.decodeWatchHandoffReply
import com.flashcardsopensourceapp.data.local.watch.encodeWatchHandoffRequest
import com.flashcardsopensourceapp.data.local.watch.watchHandoffCapabilityName
import com.flashcardsopensourceapp.data.local.watch.watchHandoffContractVersion
import com.flashcardsopensourceapp.data.local.watch.watchHandoffRpcPath
import com.flashcardsopensourceapp.wear.BuildConfig
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.Node
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableStatusCodes
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull

// The Data Layer does not time out an unanswered request.
private const val wearHandoffReplyTimeoutSeconds: Int = 20
private const val phoneAvailabilityTimeoutMillis: Long = 3_000
private const val playStoreLaunchTimeoutMillis: Long = 10_000

class WearHandoffPhoneUnreachableException(
    detail: String
) : IllegalStateException("The paired phone is not reachable: $detail")

class WearHandoffPhoneAppRequiredException :
    IllegalStateException("The reachable Android phone does not advertise capability \"$watchHandoffCapabilityName\"")

class WearHandoffPhoneAvailabilityUnknownException(availability: Int?) :
    IllegalStateException("The Android phone's availability is unknown: remoteActivityAvailability=${availability ?: "timed_out"}")

private class WearPhonePlayStoreLaunchTimedOutException :
    IllegalStateException("The phone did not confirm the Google Play request within ${playStoreLaunchTimeoutMillis}ms")

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

class WearHandoffClient(private val context: Context) {
    private val capabilityClient: CapabilityClient = Wearable.getCapabilityClient(context)
    private val messageClient = Wearable.getMessageClient(context)
    private val remoteActivityHelper = RemoteActivityHelper(context, context.mainExecutor)

    suspend fun requestHandoff(): WatchHandoffReply {
        val payload = withTimeoutOrNull(timeMillis = wearHandoffReplyTimeoutSeconds * 1_000L) {
            val phoneNode = findReachablePhoneNode()
            sendHandoffRequest(phoneNode = phoneNode)
        } ?: throw WearHandoffReplyTimedOutException(seconds = wearHandoffReplyTimeoutSeconds)
        return decodeHandoffReply(payload = payload)
    }

    suspend fun openPhonePlayStore() {
        val intent = Intent(
            Intent.ACTION_VIEW,
            "market://details?id=${BuildConfig.APPLICATION_ID}".toUri()
        ).addCategory(Intent.CATEGORY_BROWSABLE)
        withTimeoutOrNull(timeMillis = playStoreLaunchTimeoutMillis) {
            remoteActivityHelper.startRemoteActivity(targetIntent = intent, targetNodeId = null).await()
            Unit
        } ?: throw WearPhonePlayStoreLaunchTimedOutException()
    }

    private suspend fun findReachablePhoneNode(): Node {
        val nodes = handoffNodes(filter = CapabilityClient.FILTER_REACHABLE)
        return nodes.firstOrNull(Node::isNearby) ?: nodes.firstOrNull() ?: failWithoutReachableCapability()
    }

    private suspend fun failWithoutReachableCapability(): Nothing {
        val phoneType = PhoneTypeHelper.getPhoneDeviceType(context)
        if (phoneType != PhoneTypeHelper.DEVICE_TYPE_ANDROID) {
            throw WearHandoffPhoneUnreachableException(detail = "pairedPhoneType=$phoneType")
        }

        // The remote activity status refers to the paired phone, unlike the Data Layer's node list.
        val availability = withTimeoutOrNull(timeMillis = phoneAvailabilityTimeoutMillis) {
            remoteActivityHelper.availabilityStatus.first()
        }
        if (availability == RemoteActivityHelper.STATUS_UNAVAILABLE ||
            availability == RemoteActivityHelper.STATUS_TEMPORARILY_UNAVAILABLE
        ) {
            throw WearHandoffPhoneUnreachableException(detail = "remoteActivityAvailability=$availability")
        }

        if (handoffNodes(filter = CapabilityClient.FILTER_ALL).isNotEmpty()) {
            throw WearHandoffPhoneUnreachableException(detail = "the phone capability is not reachable")
        }

        if (availability == RemoteActivityHelper.STATUS_AVAILABLE) {
            throw WearHandoffPhoneAppRequiredException()
        }
        throw WearHandoffPhoneAvailabilityUnknownException(availability = availability)
    }

    private suspend fun handoffNodes(@CapabilityClient.NodeFilterType filter: Int): Set<Node> {
        try {
            return capabilityClient.getCapability(watchHandoffCapabilityName, filter).await().nodes
        } catch (error: ApiException) {
            throw WearHandoffRequestFailedException(
                stage = "capability_lookup filter=$filter",
                statusCode = error.statusCode,
                statusMessage = error.status.statusMessage
            )
        }
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
