package com.flashcardsopensourceapp.data.local.cloud

import com.flashcardsopensourceapp.data.local.model.SyncEntityType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONException
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

internal enum class CloudHttpMethod(
    val requestMethod: String
) {
    GET(requestMethod = "GET"),
    POST(requestMethod = "POST")
}

internal data class ParsedCloudErrorPayload(
    val message: String?,
    val code: String?,
    val requestId: String?,
    val syncConflict: CloudSyncConflictDetails?
)

internal class CloudJsonHttpClient {
    suspend fun getJson(
        baseUrl: String,
        path: String,
        authorizationHeader: String?
    ): JSONObject {
        return executeJsonRequest(
            baseUrl = baseUrl,
            path = path,
            method = CloudHttpMethod.GET,
            authorizationHeader = authorizationHeader,
            body = null
        )
    }

    suspend fun postJson(
        baseUrl: String,
        path: String,
        authorizationHeader: String?,
        body: JSONObject?
    ): JSONObject {
        return executeJsonRequest(
            baseUrl = baseUrl,
            path = path,
            method = CloudHttpMethod.POST,
            authorizationHeader = authorizationHeader,
            body = body
        )
    }

    private suspend fun executeJsonRequest(
        baseUrl: String,
        path: String,
        method: CloudHttpMethod,
        authorizationHeader: String?,
        body: JSONObject?
    ): JSONObject = withContext(Dispatchers.IO) {
        val normalizedBaseUrl = if (baseUrl.endsWith("/")) {
            baseUrl.dropLast(1)
        } else {
            baseUrl
        }
        val connection = (URL("$normalizedBaseUrl$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method.requestMethod
            connectTimeout = 15_000
            readTimeout = 30_000
            doInput = true
            setRequestProperty("Content-Type", "application/json")
            if (authorizationHeader != null) {
                setRequestProperty("Authorization", authorizationHeader)
            }
            if (body != null) {
                doOutput = true
                outputStream.use { output ->
                    output.write(body.toString().toByteArray(StandardCharsets.UTF_8))
                }
            }
        }

        try {
            val statusCode = connection.responseCode
            val responseBody = readConnectionBody(connection = connection, useErrorStream = statusCode >= 400)
            if (statusCode < 200 || statusCode >= 300) {
                val parsedError = parseCloudErrorPayload(responseBody = responseBody)
                throw CloudRemoteException(
                    message = formatCloudRemoteErrorMessage(
                        statusCode = statusCode,
                        path = path,
                        parsedError = parsedError,
                        responseBody = responseBody
                    ),
                    statusCode = statusCode,
                    responseBody = responseBody,
                    errorCode = parsedError?.code,
                    requestId = parsedError?.requestId,
                    syncConflict = parsedError?.syncConflict
                )
            }

            if (responseBody.isBlank()) {
                JSONObject()
            } else {
                JSONObject(responseBody)
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun readConnectionBody(connection: HttpURLConnection, useErrorStream: Boolean): String {
        val inputStream = if (useErrorStream) {
            connection.errorStream
        } else {
            connection.inputStream
        } ?: return ""

        return inputStream.use { stream ->
            BufferedReader(InputStreamReader(stream, StandardCharsets.UTF_8)).use { reader ->
                reader.readText()
            }
        }
    }
}

private fun formatCloudRemoteErrorMessage(
    statusCode: Int,
    path: String,
    parsedError: ParsedCloudErrorPayload?,
    responseBody: String
): String {
    val message = parsedError?.message?.trim().orEmpty()
    if (message.isNotEmpty()) {
        val requestId = parsedError?.requestId?.trim().orEmpty()
        return if (requestId.isEmpty()) {
            message
        } else {
            "$message Reference: $requestId"
        }
    }

    return if (responseBody.isBlank()) {
        "Cloud request failed with status $statusCode for $path."
    } else {
        "Cloud request failed with status $statusCode for $path. Response body: $responseBody"
    }
}

internal fun parseCloudErrorPayload(responseBody: String): ParsedCloudErrorPayload? {
    if (responseBody.isBlank()) {
        return null
    }

    return try {
        val payload = JSONObject(responseBody)
        val nestedErrorValue = payload.opt("error")
        val nestedErrorObject = nestedErrorValue as? JSONObject
        val topLevelMessage = (nestedErrorValue as? String)
            ?: payload.optCloudStringOrNull("message", "error.message")
        val topLevelCode = payload.optCloudStringOrNull("code", "error.code")
        val nestedMessage = nestedErrorObject?.optCloudStringOrNull("message", "error.error.message")
        val nestedCode = nestedErrorObject?.optCloudStringOrNull("code", "error.error.code")
        val requestId = payload.optCloudStringOrNull("requestId", "error.requestId")
        val topLevelDetails = payload.optCloudObjectOrNull("details", "error.details")
        val nestedDetails = nestedErrorObject?.optCloudObjectOrNull("details", "error.error.details")
        ParsedCloudErrorPayload(
            message = topLevelMessage ?: nestedMessage,
            code = topLevelCode ?: nestedCode,
            requestId = requestId,
            syncConflict = parseSyncConflictDetails(
                details = topLevelDetails ?: nestedDetails
            )
        )
    } catch (_: JSONException) {
        null
    } catch (_: CloudContractMismatchException) {
        null
    }
}

private fun parseSyncConflictDetails(details: JSONObject?): CloudSyncConflictDetails? {
    if (details == null) {
        return null
    }

    return try {
        val syncConflict = details.optCloudObjectOrNull("syncConflict", "error.details.syncConflict") ?: return null
        val rawEntityType = syncConflict.optCloudStringOrNull(
            key = "entityType",
            fieldPath = "error.details.syncConflict.entityType"
        )
        CloudSyncConflictDetails(
            entityType = rawEntityType?.let { value ->
                parseSyncConflictEntityType(
                    rawValue = value,
                    fieldPath = "error.details.syncConflict.entityType"
                )
            },
            entityId = syncConflict.optCloudStringOrNull(
                key = "entityId",
                fieldPath = "error.details.syncConflict.entityId"
            ),
            entryIndex = syncConflict.optCloudIntOrNull(
                key = "entryIndex",
                fieldPath = "error.details.syncConflict.entryIndex"
            ),
            reviewEventIndex = syncConflict.optCloudIntOrNull(
                key = "reviewEventIndex",
                fieldPath = "error.details.syncConflict.reviewEventIndex"
            ),
            recoverable = syncConflict.optCloudBooleanOrNull(
                key = "recoverable",
                fieldPath = "error.details.syncConflict.recoverable"
            ),
            conflictingWorkspaceId = syncConflict.optCloudStringOrNull(
                key = "conflictingWorkspaceId",
                fieldPath = "error.details.syncConflict.conflictingWorkspaceId"
            ),
            remoteIsEmpty = syncConflict.optCloudBooleanOrNull(
                key = "remoteIsEmpty",
                fieldPath = "error.details.syncConflict.remoteIsEmpty"
            )
        )
    } catch (_: CloudContractMismatchException) {
        null
    }
}

private fun parseSyncConflictEntityType(rawValue: String, fieldPath: String): SyncEntityType {
    return when (rawValue) {
        "card" -> SyncEntityType.CARD
        "deck" -> SyncEntityType.DECK
        "review_event" -> SyncEntityType.REVIEW_EVENT
        else -> throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: expected one of [card, deck, review_event], got invalid string \"$rawValue\""
        )
    }
}
