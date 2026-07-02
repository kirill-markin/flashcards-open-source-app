package com.flashcardsopensourceapp.data.local.cloud.remote.media

import com.flashcardsopensourceapp.data.local.cloud.remote.transport.CloudJsonHttpClient
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.buildMediaAssetDownloadUrlCloudPath
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.buildMediaAssetUploadSessionAbortCloudPath
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.buildMediaAssetUploadSessionCompleteCloudPath
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.buildMediaAssetUploadSessionCreateCloudPath
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.buildMediaAssetUploadSessionPartsCloudPath
import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.cloud.wire.putNullableString
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudArray
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudBoolean
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudIsoTimestampMillis
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudInt
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudLong
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudNullableIsoTimestampMillis
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudNullableString
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudObject
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudString
import com.flashcardsopensourceapp.data.local.model.cloud.formatIsoTimestamp
import com.flashcardsopensourceapp.data.local.model.media.CompleteMediaAssetUploadSessionRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAsset
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetDownloadUrl
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadCompletion
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadPartUrl
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadPartUrlsRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadPartUrlsResponse
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadSession
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadSessionAbort
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadSessionCreateRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadSessionCreateResponse
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadSessionCreateStatus
import org.json.JSONArray
import org.json.JSONObject

private const val mediaAssetDownloadHttpMethod: String = "GET"
private const val mediaAssetUploadPartHttpMethod: String = "PUT"

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

    suspend fun createMediaAssetUploadSession(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        request: MediaAssetUploadSessionCreateRequest
    ): MediaAssetUploadSessionCreateResponse {
        val response = httpClient.postJson(
            baseUrl = apiBaseUrl,
            path = buildMediaAssetUploadSessionCreateCloudPath(workspaceId = workspaceId),
            authorizationHeader = authorizationHeader,
            body = buildMediaAssetUploadSessionCreateRequestBody(request = request)
        )
        return parseMediaAssetUploadSessionCreateResponse(
            response = response,
            fieldPath = "mediaAssetUploadSessionCreate"
        )
    }

    suspend fun createMediaAssetUploadPartUrls(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        sessionId: String,
        request: MediaAssetUploadPartUrlsRequest
    ): MediaAssetUploadPartUrlsResponse {
        val response = httpClient.postJson(
            baseUrl = apiBaseUrl,
            path = buildMediaAssetUploadSessionPartsCloudPath(
                workspaceId = workspaceId,
                sessionId = sessionId
            ),
            authorizationHeader = authorizationHeader,
            body = buildMediaAssetUploadPartUrlsRequestBody(request = request)
        )
        return parseMediaAssetUploadPartUrlsResponse(
            response = response,
            fieldPath = "mediaAssetUploadPartUrls"
        )
    }

    suspend fun completeMediaAssetUploadSession(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        sessionId: String,
        request: CompleteMediaAssetUploadSessionRequest
    ): MediaAssetUploadCompletion {
        val response = httpClient.postJson(
            baseUrl = apiBaseUrl,
            path = buildMediaAssetUploadSessionCompleteCloudPath(
                workspaceId = workspaceId,
                sessionId = sessionId
            ),
            authorizationHeader = authorizationHeader,
            body = buildCompleteMediaAssetUploadSessionRequestBody(request = request)
        )
        return parseCompleteMediaAssetUploadSessionResponse(
            response = response,
            fieldPath = "completeMediaAssetUploadSession"
        )
    }

    suspend fun abortMediaAssetUploadSession(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        sessionId: String
    ): MediaAssetUploadSessionAbort {
        val response = httpClient.postJson(
            baseUrl = apiBaseUrl,
            path = buildMediaAssetUploadSessionAbortCloudPath(
                workspaceId = workspaceId,
                sessionId = sessionId
            ),
            authorizationHeader = authorizationHeader,
            body = null
        )
        return parseMediaAssetUploadSessionAbortResponse(
            response = response,
            fieldPath = "mediaAssetUploadSessionAbort"
        )
    }
}

internal fun buildMediaAssetUploadSessionCreateRequestBody(request: MediaAssetUploadSessionCreateRequest): JSONObject {
    return JSONObject()
        .put("mediaAssetId", request.mediaAssetId)
        .put("mimeType", request.mimeType)
        .put("sizeBytes", request.sizeBytes)
        .put("sha256", request.sha256)
        .put("partSizeBytes", request.partSizeBytes)
        .put("partCount", request.partCount)
        .putNullableString("sourceUrl", request.sourceUrl)
        .put("createdAt", formatIsoTimestamp(request.createdAtMillis))
        .put("clientUpdatedAt", formatIsoTimestamp(request.clientUpdatedAtMillis))
        .put("lastModifiedByReplicaId", request.lastModifiedByReplicaId)
        .put("lastOperationId", request.lastOperationId)
}

internal fun buildMediaAssetUploadPartUrlsRequestBody(request: MediaAssetUploadPartUrlsRequest): JSONObject {
    return JSONObject()
        .put(
            "parts",
            JSONArray(
                request.parts.map { part ->
                    JSONObject()
                        .put("partNumber", part.partNumber)
                        .put("sha256", part.sha256)
                }
            )
        )
}

internal fun buildCompleteMediaAssetUploadSessionRequestBody(
    request: CompleteMediaAssetUploadSessionRequest
): JSONObject {
    return JSONObject()
        .put(
            "parts",
            JSONArray(
                request.parts.map { part ->
                    JSONObject()
                        .put("partNumber", part.partNumber)
                        .put("eTag", part.eTag)
                        .put("sha256", part.sha256)
                }
            )
        )
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

internal fun parseMediaAssetUploadSessionCreateResponse(
    response: JSONObject,
    fieldPath: String
): MediaAssetUploadSessionCreateResponse {
    val status = parseMediaAssetUploadSessionCreateStatus(
        rawStatus = response.requireCloudString("status", "$fieldPath.status"),
        fieldPath = "$fieldPath.status"
    )
    val mediaAsset = response.requireCloudNullableObject(
        key = "mediaAsset",
        fieldPath = "$fieldPath.mediaAsset"
    )?.let { mediaAssetObject ->
        parseCloudMediaAsset(
            mediaAsset = mediaAssetObject,
            fieldPath = "$fieldPath.mediaAsset"
        )
    }
    val uploadSession = response.requireCloudNullableObject(
        key = "uploadSession",
        fieldPath = "$fieldPath.uploadSession"
    )?.let { uploadSessionObject ->
        parseMediaAssetUploadSession(
            uploadSession = uploadSessionObject,
            fieldPath = "$fieldPath.uploadSession"
        )
    }
    requireMediaAssetUploadSessionCreateShape(
        status = status,
        mediaAsset = mediaAsset,
        uploadSession = uploadSession,
        fieldPath = fieldPath
    )
    return MediaAssetUploadSessionCreateResponse(
        workspaceId = response.requireCloudString("workspaceId", "$fieldPath.workspaceId"),
        mediaAssetId = response.requireCloudString("mediaAssetId", "$fieldPath.mediaAssetId"),
        status = status,
        mediaAsset = mediaAsset,
        uploadSession = uploadSession
    )
}

internal fun parseMediaAssetUploadPartUrlsResponse(
    response: JSONObject,
    fieldPath: String
): MediaAssetUploadPartUrlsResponse {
    val partUrls = response.requireCloudArray("partUrls", "$fieldPath.partUrls")
    if (partUrls.length() == 0) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath.partUrls: expected non-empty array, got empty array"
        )
    }
    return MediaAssetUploadPartUrlsResponse(
        sessionId = response.requireCloudString("sessionId", "$fieldPath.sessionId"),
        partUrls = parseMediaAssetUploadPartUrls(
            partUrls = partUrls,
            fieldPath = "$fieldPath.partUrls"
        )
    )
}

internal fun parseCompleteMediaAssetUploadSessionResponse(
    response: JSONObject,
    fieldPath: String
): MediaAssetUploadCompletion {
    return MediaAssetUploadCompletion(
        mediaAsset = parseCloudMediaAsset(
            mediaAsset = response.requireCloudObject("mediaAsset", "$fieldPath.mediaAsset"),
            fieldPath = "$fieldPath.mediaAsset"
        ),
        applied = response.requireCloudBoolean("applied", "$fieldPath.applied")
    )
}

internal fun parseMediaAssetUploadSessionAbortResponse(
    response: JSONObject,
    fieldPath: String
): MediaAssetUploadSessionAbort {
    return MediaAssetUploadSessionAbort(
        sessionId = response.requireCloudString("sessionId", "$fieldPath.sessionId"),
        abortedAtMillis = response.requireCloudIsoTimestampMillis("abortedAt", "$fieldPath.abortedAt")
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

private fun parseMediaAssetUploadSessionCreateStatus(
    rawStatus: String,
    fieldPath: String
): MediaAssetUploadSessionCreateStatus {
    return try {
        MediaAssetUploadSessionCreateStatus.fromWireKey(wireKey = rawStatus)
    } catch (error: IllegalArgumentException) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: expected one of [already_available, upload_required], " +
                "got invalid string \"$rawStatus\"",
            error
        )
    }
}

private fun parseMediaAssetUploadSession(
    uploadSession: JSONObject,
    fieldPath: String
): MediaAssetUploadSession {
    return MediaAssetUploadSession(
        sessionId = uploadSession.requireCloudString("sessionId", "$fieldPath.sessionId"),
        expiresAtMillis = uploadSession.requireCloudIsoTimestampMillis("expiresAt", "$fieldPath.expiresAt"),
        partSizeBytes = uploadSession.requireCloudPositiveLong(
            key = "partSizeBytes",
            fieldPath = "$fieldPath.partSizeBytes"
        ),
        partCount = uploadSession.requireCloudPositiveInt(
            key = "partCount",
            fieldPath = "$fieldPath.partCount"
        )
    )
}

private fun requireMediaAssetUploadSessionCreateShape(
    status: MediaAssetUploadSessionCreateStatus,
    mediaAsset: MediaAsset?,
    uploadSession: MediaAssetUploadSession?,
    fieldPath: String
) {
    when (status) {
        MediaAssetUploadSessionCreateStatus.ALREADY_AVAILABLE -> {
            if (mediaAsset == null || uploadSession != null) {
                throw CloudContractMismatchException(
                    "Cloud contract mismatch for $fieldPath: already_available requires mediaAsset and null uploadSession."
                )
            }
        }

        MediaAssetUploadSessionCreateStatus.UPLOAD_REQUIRED -> {
            if (mediaAsset != null || uploadSession == null) {
                throw CloudContractMismatchException(
                    "Cloud contract mismatch for $fieldPath: upload_required requires null mediaAsset and uploadSession."
                )
            }
        }
    }
}

private fun parseMediaAssetUploadPartUrls(
    partUrls: JSONArray,
    fieldPath: String
): List<MediaAssetUploadPartUrl> {
    return buildList {
        for (index in 0 until partUrls.length()) {
            val partUrl = partUrls.requireCloudObject(index = index, fieldPath = "$fieldPath[$index]")
            add(
                parseMediaAssetUploadPartUrl(
                    partUrl = partUrl,
                    fieldPath = "$fieldPath[$index]"
                )
            )
        }
    }
}

private fun parseMediaAssetUploadPartUrl(
    partUrl: JSONObject,
    fieldPath: String
): MediaAssetUploadPartUrl {
    val method = partUrl.requireCloudString("method", "$fieldPath.method")
    if (method != mediaAssetUploadPartHttpMethod) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath.method: " +
                "expected \"$mediaAssetUploadPartHttpMethod\", got invalid string \"$method\""
        )
    }
    return MediaAssetUploadPartUrl(
        partNumber = partUrl.requireCloudPositiveInt("partNumber", "$fieldPath.partNumber"),
        method = method,
        url = partUrl.requireCloudString("url", "$fieldPath.url"),
        expiresAtMillis = partUrl.requireCloudIsoTimestampMillis("expiresAt", "$fieldPath.expiresAt"),
        headers = parseMediaAssetUploadPartHeaders(
            headers = partUrl.requireCloudObject("headers", "$fieldPath.headers"),
            fieldPath = "$fieldPath.headers"
        )
    )
}

private fun parseMediaAssetUploadPartHeaders(
    headers: JSONObject,
    fieldPath: String
): Map<String, String> {
    val headerNames: Iterator<String> = headers.keys()
    return buildMap {
        while (headerNames.hasNext()) {
            val headerName: String = headerNames.next()
            put(
                headerName,
                headers.requireCloudString(headerName, "$fieldPath.$headerName")
            )
        }
    }
}

private fun JSONObject.requireCloudNullableObject(
    key: String,
    fieldPath: String
): JSONObject? {
    if (has(key).not()) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: expected object or null, got missing"
        )
    }
    val value = get(key)
    return when {
        value === JSONObject.NULL -> null
        value is JSONObject -> value
        else -> throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: expected object or null, got invalid value"
        )
    }
}

private fun JSONObject.requireCloudPositiveInt(
    key: String,
    fieldPath: String
): Int {
    val value: Int = requireCloudInt(key = key, fieldPath = fieldPath)
    if (value <= 0) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: expected positive integer, got $value"
        )
    }
    return value
}

private fun JSONObject.requireCloudPositiveLong(
    key: String,
    fieldPath: String
): Long {
    val value: Long = requireCloudLong(key = key, fieldPath = fieldPath)
    if (value <= 0L) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: expected positive integer, got $value"
        )
    }
    return value
}
