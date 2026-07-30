package com.flashcardsopensourceapp.data.local.cloud.remote.transport

import com.flashcardsopensourceapp.data.local.cloud.remote.CloudSyncConflictDetails
import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.cloud.wire.optCloudBooleanOrNull
import com.flashcardsopensourceapp.data.local.cloud.wire.optCloudIntOrNull
import com.flashcardsopensourceapp.data.local.cloud.wire.optCloudObjectOrNull
import com.flashcardsopensourceapp.data.local.cloud.wire.optCloudStringOrNull
import com.flashcardsopensourceapp.data.local.model.sync.SyncEntityType
import org.json.JSONException
import org.json.JSONObject

private val expectedCloudHttpFailureCodes: Set<String> = setOf(
    "AGENT_API_KEY_INVALID",
    "AGENT_API_KEY_REQUIRED",
    "AGENT_API_KEY_HUMAN_SESSION_REQUIRED",
    "AGENT_API_KEY_ID_INVALID",
    "AGENT_API_KEY_ID_REQUIRED",
    "AGENT_API_KEY_NOT_FOUND",
    "ACCOUNT_DELETED",
    "ACCOUNT_PREFERENCES_FIELD_UNKNOWN",
    "ACCOUNT_PREFERENCES_HUMAN_AUTH_REQUIRED",
    "ACCOUNT_SIGN_IN_REQUIRED",
    "AUTH_UNAUTHORIZED",
    "FEEDBACK_HUMAN_AUTH_REQUIRED",
    "FEEDBACK_INVALID_REQUEST",
    "FEEDBACK_MESSAGE_TOO_LONG",
    "FEEDBACK_PLATFORM_INVALID",
    "FEEDBACK_PROMPT_EVENT_ID_CONFLICT",
    "FEEDBACK_PROMPT_EVENT_TYPE_INVALID",
    "FEEDBACK_STATE_UNAVAILABLE",
    "FEEDBACK_SUBMISSION_ID_CONFLICT",
    "FEEDBACK_TIMESTAMP_INVALID",
    "FEEDBACK_TIMEZONE_INVALID",
    "FEEDBACK_TRIGGER_INVALID",
    "FRIEND_INVITATION_DISPLAY_NAME_INVALID",
    "FRIEND_INVITATION_FIELD_UNKNOWN",
    "FRIEND_INVITATION_HUMAN_AUTH_REQUIRED",
    "FRIEND_INVITATION_LIMIT_REACHED",
    "FRIEND_INVITATION_SELF",
    "FRIEND_INVITATION_TOKEN_INVALID",
    "GUEST_AUTH_INVALID",
    "GUEST_SESSION_DELETE_GUEST_AUTH_REQUIRED",
    "GUEST_SESSION_DELETE_LINKED_ACCOUNT",
    "GUEST_SESSION_PLATFORM_INVALID",
    "GUEST_SESSION_PLATFORM_MISMATCH",
    "GUEST_UPGRADE_ACCOUNT_REQUIRED",
    "GUEST_UPGRADE_GUEST_SYNC_NOT_DRAINED",
    "GUEST_UPGRADE_HUMAN_AUTH_REQUIRED",
    "GUEST_UPGRADE_SELECTION_INVALID",
    "GUEST_WEB_SESSION_UNSUPPORTED",
    "GUEST_WEB_SYNC_UNSUPPORTED",
    "INVALID_EMAIL",
    "INVALID_REQUEST",
    "MEDIA_ASSET_ALREADY_REGISTERED",
    "MEDIA_ASSET_DUPLICATE_PART_NUMBER",
    "MEDIA_ASSET_ID_CONFLICT",
    "MEDIA_ASSET_ID_INVALID",
    "MEDIA_ASSET_ID_REQUIRED",
    "MEDIA_ASSET_NOT_FOUND",
    "MEDIA_ASSET_PART_COUNT_INVALID",
    "MEDIA_ASSET_PART_COUNT_MISMATCH",
    "MEDIA_ASSET_PART_NUMBER_INVALID",
    "MEDIA_ASSET_PART_NUMBER_OUT_OF_RANGE",
    "MEDIA_ASSET_PART_SEQUENCE_INVALID",
    "MEDIA_ASSET_PART_SIZE_TOO_LARGE",
    "MEDIA_ASSET_PARTS_REQUIRED",
    "MEDIA_ASSET_PART_URL_BATCH_TOO_LARGE",
    "MEDIA_ASSET_REPLICA_INVALID",
    "MEDIA_ASSET_SIZE_INVALID",
    "MEDIA_ASSET_SIZE_TOO_LARGE",
    "MEDIA_ASSET_UPLOAD_MISMATCH",
    "MEDIA_ASSET_UPLOAD_NOT_FOUND",
    "MEDIA_ASSET_UPLOAD_PROOF_MISMATCH",
    "MEDIA_ASSET_UPLOAD_SESSION_ABORTED",
    "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED",
    "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
    "MEDIA_ASSET_UPLOAD_SESSION_COMPLETED",
    "MEDIA_ASSET_UPLOAD_SESSION_EXPIRED",
    "MEDIA_ASSET_UPLOAD_SESSION_ID_INVALID",
    "MEDIA_ASSET_UPLOAD_SESSION_ID_REQUIRED",
    "MEDIA_ASSET_UPLOAD_SESSION_NOT_FOUND",
    "MEDIA_ASSET_UPLOAD_SESSION_RECOVERY_FAILED",
    "MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT",
    "MEDIA_ASSET_WRITER_BUSY",
    "OTP_CHALLENGE_CONSUMED",
    "OTP_CODE_INVALID",
    "OTP_SESSION_EXPIRED",
    "OTP_TOO_MANY_ATTEMPTS",
    "OTP_VERIFY_FAILED",
    "PASSWORD_SIGN_IN_FAILED",
    "PROGRESS_FROM_INVALID",
    "PROGRESS_FROM_REQUIRED",
    "PROGRESS_HUMAN_AUTH_REQUIRED",
    "PROGRESS_RANGE_INVALID",
    "PROGRESS_RANGE_TOO_LARGE",
    "PROGRESS_TIMEZONE_INVALID",
    "PROGRESS_TIMEZONE_REQUIRED",
    "PROGRESS_TO_INVALID",
    "PROGRESS_TO_REQUIRED",
    "RATE_LIMITED",
    "REFRESH_TOKEN_FAILED",
    "REFRESH_TOKEN_MISSING",
    "REVOKE_TOKEN_MISSING",
    "SESSION_CSRF_TOKEN_INVALID",
    "SYNC_BOOTSTRAP_NOT_EMPTY",
    "SYNC_INVALID_INPUT",
    "SYNC_WORKSPACE_FORK_REQUIRED",
    "WORKSPACE_DELETE_CONFIRMATION_INVALID",
    "WORKSPACE_ID_INVALID",
    "WORKSPACE_ID_REQUIRED",
    "WORKSPACE_NOT_FOUND",
    "WORKSPACE_OWNER_REQUIRED",
    "WORKSPACE_PACKAGE_EXPORT_PACKAGE_CARD_NOT_FOUND",
    "WORKSPACE_PACKAGE_EXPORT_PACKAGE_INPUT_INVALID",
    "WORKSPACE_PACKAGE_EXPORT_PACKAGE_MEDIA_ASSET_ID_INVALID",
    "WORKSPACE_PACKAGE_EXPORT_PACKAGE_MEDIA_ASSET_UNAVAILABLE",
    "WORKSPACE_PACKAGE_EXPORT_PACKAGE_MEDIA_FILE_COUNT_TOO_LARGE",
    "WORKSPACE_PACKAGE_EXPORT_PACKAGE_SELECTION_TOO_LARGE",
    "WORKSPACE_PACKAGE_EXPORT_PACKAGE_SINGLE_MEDIA_TOO_LARGE",
    "WORKSPACE_PACKAGE_EXPORT_PACKAGE_TOTAL_MEDIA_TOO_LARGE",
    "WORKSPACE_PACKAGE_EXPORT_PREVIEW_CARD_NOT_FOUND",
    "WORKSPACE_PACKAGE_EXPORT_PREVIEW_INPUT_INVALID",
    "WORKSPACE_PACKAGE_EXPORT_PREVIEW_MEDIA_ASSET_ID_INVALID",
    "WORKSPACE_PACKAGE_EXPORT_PREVIEW_MEDIA_ASSET_UNAVAILABLE",
    "WORKSPACE_PACKAGE_EXPORT_PREVIEW_SELECTION_TOO_LARGE",
    "WORKSPACE_PACKAGE_EXPORT_REQUEST_INVALID",
    "WORKSPACE_PACKAGE_IMPORT_CONTENT_TYPE_UNSUPPORTED",
    "WORKSPACE_PACKAGE_IMPORT_FILE_EMPTY",
    "WORKSPACE_PACKAGE_IMPORT_FILE_REQUIRED",
    "WORKSPACE_PACKAGE_IMPORT_FILE_TOO_LARGE",
    "WORKSPACE_PACKAGE_IMPORT_INPUT_INVALID",
    "WORKSPACE_PACKAGE_IMPORT_MEDIA_TYPE_UNSUPPORTED",
    "WORKSPACE_PACKAGE_IMPORT_MULTIPART_INVALID",
    "WORKSPACE_PACKAGE_IMPORT_OPTIONS_INVALID",
    "WORKSPACE_PACKAGE_IMPORT_OPTIONS_INVALID_JSON",
    "WORKSPACE_PACKAGE_IMPORT_OPTIONS_REQUIRED",
    "WORKSPACE_PACKAGE_IMPORT_PREVIEW_BODY_TOO_LARGE",
    "WORKSPACE_PACKAGE_IMPORT_PREVIEW_CARDS_JSON_INVALID",
    "WORKSPACE_PACKAGE_IMPORT_PREVIEW_CARDS_JSON_MALFORMED",
    "WORKSPACE_PACKAGE_IMPORT_PREVIEW_CONTENT_TYPE_UNSUPPORTED",
    "WORKSPACE_PACKAGE_IMPORT_PREVIEW_INPUT_INVALID",
    "WORKSPACE_PACKAGE_IMPORT_PREVIEW_TOO_LARGE",
    "WORKSPACE_PACKAGE_IMPORT_PREVIEW_ZIP_EMPTY",
    "WORKSPACE_PACKAGE_IMPORT_PREVIEW_ZIP_INVALID",
    "WORKSPACE_PACKAGE_IMPORT_REPLICA_INVALID",
    "WORKSPACE_RESET_PROGRESS_CONFIRMATION_INVALID",
    "WORKSPACE_DELETE_SHARED",
    "WORKSPACE_RESET_SHARED",
    "WORKSPACE_SELECTION_REQUIRED"
)

internal data class ParsedCloudErrorPayload(
    val message: String?,
    val code: String?,
    val requestId: String?,
    val syncConflict: CloudSyncConflictDetails?
)

internal data class CloudErrorResponseMetadata(
    val statusCode: Int,
    val path: String,
    val requestId: String?,
    val responseBodyLengthBytes: Int,
    val responseContentType: String?
)

internal fun isExpectedCloudHttpFailure(
    statusCode: Int,
    code: String?,
    syncConflict: CloudSyncConflictDetails?
): Boolean {
    if (statusCode == 401 || statusCode == 403 || statusCode == 429) {
        return true
    }
    if (syncConflict != null) {
        return true
    }

    val normalizedCode = code?.trim()?.uppercase() ?: return false
    return expectedCloudHttpFailureCodes.contains(element = normalizedCode)
}

internal fun parseCloudErrorPayloadWithHeaderRequestId(
    responseBody: String,
    requestId: String?
): ParsedCloudErrorPayload? {
    val normalizedRequestId = requestId?.trim()?.ifEmpty { null }
    val parsedError = parseCloudErrorPayload(responseBody = responseBody)
    if (parsedError != null) {
        return parsedError.withHeaderRequestId(requestId = normalizedRequestId)
    }
    if (normalizedRequestId == null) {
        return null
    }
    return ParsedCloudErrorPayload(
        message = null,
        code = null,
        requestId = normalizedRequestId,
        syncConflict = null
    )
}

internal fun parseCloudRetryAfterDelayMillis(value: String?): Long? {
    val seconds = value?.trim()?.toLongOrNull() ?: return null
    if (seconds < 0L || seconds > Long.MAX_VALUE / 1_000L) {
        return null
    }
    return seconds * 1_000L
}

internal fun formatCloudRemoteErrorMessage(
    parsedError: ParsedCloudErrorPayload?,
    responseBody: String,
    responseMetadata: CloudErrorResponseMetadata
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

    val metadataMessage = formatCloudErrorMetadataMessage(responseMetadata = responseMetadata)
    return if (responseBody.isBlank()) {
        "$metadataMessage Response body was empty."
    } else {
        "$metadataMessage Response body was not valid cloud error JSON."
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

private fun ParsedCloudErrorPayload.withHeaderRequestId(requestId: String?): ParsedCloudErrorPayload {
    return if (this.requestId.isNullOrBlank() && requestId.isNullOrBlank().not()) {
        copy(requestId = requestId)
    } else {
        this
    }
}

private fun formatCloudErrorMetadataMessage(responseMetadata: CloudErrorResponseMetadata): String {
    val requestIdMessage = responseMetadata.requestId?.trim()?.ifEmpty { null }?.let { requestId ->
        "Request id: $requestId."
    }
    val contentTypeMessage = responseMetadata.responseContentType?.trim()?.ifEmpty { null }?.let { contentType ->
        "Response content type: $contentType."
    }
    val responseBodyLengthMessage = "Response body length: ${responseMetadata.responseBodyLengthBytes} bytes."
    return listOfNotNull(
        "Cloud request failed with status ${responseMetadata.statusCode} for ${responseMetadata.path}.",
        requestIdMessage,
        contentTypeMessage,
        responseBodyLengthMessage
    ).joinToString(separator = " ")
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
        "media_asset" -> SyncEntityType.MEDIA_ASSET
        "review_event" -> SyncEntityType.REVIEW_EVENT
        else -> throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: expected one of [card, deck, media_asset, review_event], got invalid string \"$rawValue\""
        )
    }
}
