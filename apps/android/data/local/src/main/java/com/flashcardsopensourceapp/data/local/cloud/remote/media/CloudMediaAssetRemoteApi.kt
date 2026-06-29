package com.flashcardsopensourceapp.data.local.cloud.remote.media

import com.flashcardsopensourceapp.data.local.cloud.remote.transport.CloudJsonHttpClient
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.buildMediaAssetDownloadUrlCloudPath
import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudIsoTimestampMillis
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudLong
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudNullableIsoTimestampMillis
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudNullableString
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudObject
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudString
import com.flashcardsopensourceapp.data.local.model.media.MediaAsset
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetDownloadUrl
import org.json.JSONObject

private const val mediaAssetDownloadHttpMethod: String = "GET"

internal class CloudMediaAssetRemoteApi(
    private val httpClient: CloudJsonHttpClient
) {
    suspend fun loadMediaAssetDownloadUrl(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        mediaAssetId: String
    ): MediaAssetDownloadUrl {
        val response = httpClient.getJson(
            baseUrl = apiBaseUrl,
            path = buildMediaAssetDownloadUrlCloudPath(
                workspaceId = workspaceId,
                mediaAssetId = mediaAssetId
            ),
            authorizationHeader = authorizationHeader
        )
        return parseMediaAssetDownloadUrlResponse(
            response = response,
            fieldPath = "mediaAssetDownloadUrl"
        )
    }
}

internal fun parseMediaAssetDownloadUrlResponse(
    response: JSONObject,
    fieldPath: String
): MediaAssetDownloadUrl {
    val mediaAsset = parseCloudMediaAsset(
        mediaAsset = response.requireCloudObject("mediaAsset", "$fieldPath.mediaAsset"),
        fieldPath = "$fieldPath.mediaAsset"
    )
    val download = response.requireCloudObject("download", "$fieldPath.download")
    val method = download.requireCloudString("method", "$fieldPath.download.method")
    if (method != mediaAssetDownloadHttpMethod) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath.download.method: " +
                "expected \"$mediaAssetDownloadHttpMethod\", got invalid string \"$method\""
        )
    }

    return MediaAssetDownloadUrl(
        mediaAsset = mediaAsset,
        url = download.requireCloudString("url", "$fieldPath.download.url"),
        expiresAtMillis = download.requireCloudIsoTimestampMillis("expiresAt", "$fieldPath.download.expiresAt")
    )
}

private fun parseCloudMediaAsset(
    mediaAsset: JSONObject,
    fieldPath: String
): MediaAsset {
    return MediaAsset(
        mediaAssetId = mediaAsset.requireCloudString("mediaAssetId", "$fieldPath.mediaAssetId"),
        workspaceId = mediaAsset.requireCloudString("workspaceId", "$fieldPath.workspaceId"),
        mimeType = mediaAsset.requireCloudString("mimeType", "$fieldPath.mimeType"),
        sizeBytes = mediaAsset.requireCloudLong("sizeBytes", "$fieldPath.sizeBytes"),
        sha256 = mediaAsset.requireCloudString("sha256", "$fieldPath.sha256"),
        sourceUrl = mediaAsset.requireCloudNullableString("sourceUrl", "$fieldPath.sourceUrl"),
        createdAtMillis = mediaAsset.requireCloudIsoTimestampMillis("createdAt", "$fieldPath.createdAt"),
        clientUpdatedAtMillis = mediaAsset.requireCloudIsoTimestampMillis(
            "clientUpdatedAt",
            "$fieldPath.clientUpdatedAt"
        ),
        lastModifiedByReplicaId = mediaAsset.requireCloudString(
            "lastModifiedByReplicaId",
            "$fieldPath.lastModifiedByReplicaId"
        ),
        lastOperationId = mediaAsset.requireCloudString("lastOperationId", "$fieldPath.lastOperationId"),
        updatedAtMillis = mediaAsset.requireCloudIsoTimestampMillis("updatedAt", "$fieldPath.updatedAt"),
        deletedAtMillis = mediaAsset.requireCloudNullableIsoTimestampMillis("deletedAt", "$fieldPath.deletedAt")
    )
}
