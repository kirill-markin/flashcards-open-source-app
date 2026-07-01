package com.flashcardsopensourceapp.data.local.cloud.remote.workspace

import com.flashcardsopensourceapp.data.local.cloud.remote.transport.CloudBinaryHttpResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.CloudJsonHttpClient
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.buildWorkspacePackageExportCloudPath
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.buildWorkspacePackageExportPreviewCloudPath
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.buildWorkspacePackageImportCloudPath
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.buildWorkspacePackageImportPreviewCloudPath
import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.cloud.wire.optCloudStringOrNull
import com.flashcardsopensourceapp.data.local.cloud.wire.putNullableString
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudArray
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudBoolean
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudInt
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudLong
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudNullableString
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudObject
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudString
import com.flashcardsopensourceapp.data.local.cloud.wire.toCloudStringList
import com.flashcardsopensourceapp.data.local.model.cloud.formatIsoTimestamp
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportDefaultPackageMetadata
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportDownloadResponse
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportMetadataInput
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportPreview
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportRequest
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportSelection
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportTagCount
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportTagPolicyInput
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportConfirmOptions
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportConfirmResult
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportConfirmSummary
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportDefaultOptions
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportMetadata
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportPreview
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportSourceKind
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportTagCount
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportWarning
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

private const val workspacePackageExportContentType: String = "application/zip"
private const val workspacePackageExportFilenameFieldPath: String = "workspacePackageExport.fileName"
private const val workspacePackageImportFileFieldName: String = "file"
private const val workspacePackageImportOptionsFieldName: String = "options"

internal class CloudWorkspacePackageRemoteApi(
    private val httpClient: CloudJsonHttpClient
) {
    suspend fun previewWorkspacePackageExport(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        request: WorkspacePackageExportRequest
    ): WorkspacePackageExportPreview {
        val response = httpClient.postJson(
            baseUrl = apiBaseUrl,
            path = buildWorkspacePackageExportPreviewCloudPath(workspaceId = workspaceId),
            authorizationHeader = authorizationHeader,
            body = buildWorkspacePackageExportRequestBody(request = request)
        )
        return parseWorkspacePackageExportPreviewResponse(
            response = response,
            fieldPath = "workspacePackageExportPreview"
        )
    }

    suspend fun exportWorkspacePackage(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        request: WorkspacePackageExportRequest
    ): WorkspacePackageExportDownloadResponse {
        val response = httpClient.postJsonForBytes(
            baseUrl = apiBaseUrl,
            path = buildWorkspacePackageExportCloudPath(workspaceId = workspaceId),
            authorizationHeader = authorizationHeader,
            body = buildWorkspacePackageExportRequestBody(request = request),
            acceptHeader = workspacePackageExportContentType
        )
        return parseWorkspacePackageExportDownloadResponse(
            response = response,
            fieldPath = "workspacePackageExport"
        )
    }

    suspend fun previewWorkspacePackageImport(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        packageBytes: ByteArray
    ): WorkspacePackageImportPreview {
        val response = httpClient.postZipForJson(
            baseUrl = apiBaseUrl,
            path = buildWorkspacePackageImportPreviewCloudPath(workspaceId = workspaceId),
            authorizationHeader = authorizationHeader,
            zipBytes = packageBytes
        )
        return parseWorkspacePackageImportPreview(
            response = response,
            fieldPath = "workspacePackageImportPreview"
        )
    }

    suspend fun confirmWorkspacePackageImport(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        fileName: String,
        packageBytes: ByteArray,
        lastModifiedByReplicaId: String,
        options: WorkspacePackageImportConfirmOptions
    ): WorkspacePackageImportConfirmResult {
        val response = httpClient.postMultipartZipForJson(
            baseUrl = apiBaseUrl,
            path = buildWorkspacePackageImportCloudPath(workspaceId = workspaceId),
            authorizationHeader = authorizationHeader,
            fileFieldName = workspacePackageImportFileFieldName,
            fileName = fileName,
            zipBytes = packageBytes,
            jsonFieldName = workspacePackageImportOptionsFieldName,
            jsonFieldValue = encodeWorkspacePackageImportConfirmOptions(
                options = options,
                lastModifiedByReplicaId = lastModifiedByReplicaId
            )
        )
        return WorkspacePackageImportConfirmResult(
            summary = parseWorkspacePackageImportConfirmSummary(
                summary = response.requireCloudObject("summary", "workspacePackageImport.summary"),
                fieldPath = "workspacePackageImport.summary"
            )
        )
    }
}

internal fun buildWorkspacePackageExportRequestBody(request: WorkspacePackageExportRequest): JSONObject {
    return JSONObject()
        .put("selection", buildWorkspacePackageExportSelection(selection = request.selection))
        .put("tagPolicy", buildWorkspacePackageExportTagPolicy(tagPolicy = request.tagPolicy))
        .put("packageMetadata", buildWorkspacePackageExportMetadata(metadata = request.packageMetadata))
}

private fun buildWorkspacePackageExportSelection(selection: WorkspacePackageExportSelection): JSONObject {
    return when (selection) {
        WorkspacePackageExportSelection.AllActiveCards -> JSONObject()
            .put("kind", "allActiveCards")

        is WorkspacePackageExportSelection.TagFilters -> JSONObject()
            .put("kind", "tagFilters")
            .put("includeTags", JSONArray(selection.includeTags))
            .put("excludeTags", JSONArray(selection.excludeTags))

        is WorkspacePackageExportSelection.ExplicitCardIds -> JSONObject()
            .put("kind", "explicitCardIds")
            .put("cardIds", JSONArray(selection.cardIds))
    }
}

private fun buildWorkspacePackageExportTagPolicy(
    tagPolicy: WorkspacePackageExportTagPolicyInput
): JSONObject {
    return JSONObject()
        .put("additionalRemovedTags", JSONArray(tagPolicy.additionalRemovedTags))
}

private fun buildWorkspacePackageExportMetadata(metadata: WorkspacePackageExportMetadataInput): JSONObject {
    return JSONObject()
        .putNullableString("label", metadata.label)
        .putNullableString("author", metadata.author)
        .putNullableString("comment", metadata.comment)
        .putNullableString("createdAt", metadata.createdAt)
        .putNullableString("sourceUrl", metadata.sourceUrl)
}

internal fun parseWorkspacePackageExportPreviewResponse(
    response: JSONObject,
    fieldPath: String
): WorkspacePackageExportPreview {
    val defaultPackageMetadata = response.requireCloudObject(
        "defaultPackageMetadata",
        "$fieldPath.defaultPackageMetadata"
    )
    return WorkspacePackageExportPreview(
        selectedCardCount = response.requireWorkspacePackageExportNonNegativeInt(
            key = "selectedCardCount",
            fieldPath = "$fieldPath.selectedCardCount"
        ),
        availableTagCounts = parseWorkspacePackageExportTagCounts(
            tagCounts = response.requireCloudArray("availableTagCounts", "$fieldPath.availableTagCounts"),
            fieldPath = "$fieldPath.availableTagCounts"
        ),
        tagsSelectedForRemoval = parseWorkspacePackageExportTagCounts(
            tagCounts = response.requireCloudArray("tagsSelectedForRemoval", "$fieldPath.tagsSelectedForRemoval"),
            fieldPath = "$fieldPath.tagsSelectedForRemoval"
        ),
        referencedMediaCount = response.requireWorkspacePackageExportNonNegativeInt(
            key = "referencedMediaCount",
            fieldPath = "$fieldPath.referencedMediaCount"
        ),
        approximateReferencedMediaBytes = response.requireWorkspacePackageExportNonNegativeLong(
            key = "approximateReferencedMediaBytes",
            fieldPath = "$fieldPath.approximateReferencedMediaBytes"
        ),
        defaultPackageMetadata = WorkspacePackageExportDefaultPackageMetadata(
            label = defaultPackageMetadata.requireCloudString(
                "label",
                "$fieldPath.defaultPackageMetadata.label"
            ),
            author = defaultPackageMetadata.optCloudStringOrNull(
                "author",
                "$fieldPath.defaultPackageMetadata.author"
            ),
            comment = defaultPackageMetadata.optCloudStringOrNull(
                "comment",
                "$fieldPath.defaultPackageMetadata.comment"
            ),
            createdAt = defaultPackageMetadata.requireCloudString(
                "createdAt",
                "$fieldPath.defaultPackageMetadata.createdAt"
            ),
            sourceUrl = defaultPackageMetadata.optCloudStringOrNull(
                "sourceUrl",
                "$fieldPath.defaultPackageMetadata.sourceUrl"
            )
        )
    )
}

internal fun parseWorkspacePackageExportDownloadResponse(
    response: CloudBinaryHttpResponse,
    fieldPath: String
): WorkspacePackageExportDownloadResponse {
    requireWorkspacePackageExportZipContentType(
        contentType = response.contentType,
        fieldPath = "$fieldPath.contentType"
    )
    return WorkspacePackageExportDownloadResponse(
        packageBytes = response.bodyBytes,
        fileName = parseWorkspacePackageExportContentDispositionFileName(
            contentDisposition = response.contentDisposition,
            fieldPath = workspacePackageExportFilenameFieldPath
        ),
        contentType = response.contentType ?: throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath.contentType: expected application/zip, got missing header"
        )
    )
}

private fun parseWorkspacePackageExportTagCounts(
    tagCounts: JSONArray,
    fieldPath: String
): List<WorkspacePackageExportTagCount> {
    return buildList {
        for (index in 0 until tagCounts.length()) {
            val tagCount = tagCounts.requireCloudObject(index = index, fieldPath = "$fieldPath[$index]")
            add(
                WorkspacePackageExportTagCount(
                    tag = tagCount.requireCloudString("tag", "$fieldPath[$index].tag"),
                    cardsCount = tagCount.requireWorkspacePackageExportNonNegativeInt(
                        key = "cardsCount",
                        fieldPath = "$fieldPath[$index].cardsCount"
                    )
                )
            )
        }
    }
}

private fun JSONObject.requireWorkspacePackageExportNonNegativeInt(
    key: String,
    fieldPath: String
): Int {
    val value = requireCloudInt(key = key, fieldPath = fieldPath)
    if (value < 0) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: expected non-negative integer, got $value"
        )
    }
    return value
}

private fun JSONObject.requireWorkspacePackageExportNonNegativeLong(
    key: String,
    fieldPath: String
): Long {
    val value = requireCloudLong(key = key, fieldPath = fieldPath)
    if (value < 0L) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: expected non-negative integer, got $value"
        )
    }
    return value
}

private fun requireWorkspacePackageExportZipContentType(
    contentType: String?,
    fieldPath: String
) {
    val normalizedContentType = contentType
        ?.substringBefore(delimiter = ";")
        ?.trim()
        ?.lowercase(Locale.US)
    if (normalizedContentType != workspacePackageExportContentType) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: expected application/zip, got ${contentType ?: "missing header"}"
        )
    }
}

private fun parseWorkspacePackageExportContentDispositionFileName(
    contentDisposition: String?,
    fieldPath: String
): String {
    if (contentDisposition.isNullOrBlank()) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: expected Content-Disposition filename, got missing header"
        )
    }

    for (parameter in contentDisposition.split(";").drop(1)) {
        val separatorIndex = parameter.indexOf("=")
        if (separatorIndex < 0) {
            continue
        }
        val key = parameter.substring(startIndex = 0, endIndex = separatorIndex).trim().lowercase(Locale.US)
        if (key != "filename") {
            continue
        }
        val rawFileName = parameter.substring(startIndex = separatorIndex + 1)
        val fileName = unquoteWorkspacePackageExportContentDispositionValue(value = rawFileName.trim()).trim()
        if (workspacePackageExportFileNameIsSafe(fileName = fileName)) {
            return fileName
        }
        throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: expected safe filename, got invalid string \"$fileName\""
        )
    }

    throw CloudContractMismatchException(
        "Cloud contract mismatch for $fieldPath: expected Content-Disposition filename, got missing parameter"
    )
}

private fun unquoteWorkspacePackageExportContentDispositionValue(value: String): String {
    if (value.length < 2 || value.startsWith("\"").not() || value.endsWith("\"").not()) {
        return value
    }

    return value.drop(1)
        .dropLast(1)
        .replace(oldValue = "\\\"", newValue = "\"")
        .replace(oldValue = "\\\\", newValue = "\\")
}

private fun workspacePackageExportFileNameIsSafe(fileName: String): Boolean {
    return fileName.isNotBlank() &&
        fileName.contains("/") == false &&
        fileName.contains("\\") == false &&
        fileName.any { character -> character.code < 32 || character.code == 127 } == false
}

private fun encodeWorkspacePackageImportConfirmOptions(
    options: WorkspacePackageImportConfirmOptions,
    lastModifiedByReplicaId: String
): JSONObject {
    return JSONObject()
        .put("addImportTag", options.addImportTag)
        .put("importTag", options.importTag)
        .put("removeTags", JSONArray(options.removeTags))
        .put("importedAt", formatIsoTimestamp(timestampMillis = options.importedAtMillis))
        .put("importId", options.importId)
        .put("clientUpdatedAt", formatIsoTimestamp(timestampMillis = options.clientUpdatedAtMillis))
        .put("lastModifiedByReplicaId", lastModifiedByReplicaId)
        .put("operationIdPrefix", options.operationIdPrefix)
}

private fun parseWorkspacePackageImportPreview(
    response: JSONObject,
    fieldPath: String
): WorkspacePackageImportPreview {
    val packageMetadata = response.requireCloudObject("packageMetadata", "$fieldPath.packageMetadata")
    val defaultOptions = response.requireCloudObject("defaultOptions", "$fieldPath.defaultOptions")
    return WorkspacePackageImportPreview(
        sourceKind = parseWorkspacePackageImportSourceKind(
            rawValue = response.requireCloudString("sourceKind", "$fieldPath.sourceKind"),
            fieldPath = "$fieldPath.sourceKind"
        ),
        packageMetadata = WorkspacePackageImportMetadata(
            label = packageMetadata.requireCloudNullableString("label", "$fieldPath.packageMetadata.label"),
            author = packageMetadata.requireCloudNullableString("author", "$fieldPath.packageMetadata.author"),
            comment = packageMetadata.requireCloudNullableString("comment", "$fieldPath.packageMetadata.comment"),
            createdAt = packageMetadata.requireCloudNullableString("createdAt", "$fieldPath.packageMetadata.createdAt"),
            sourceUrl = packageMetadata.requireCloudNullableString("sourceUrl", "$fieldPath.packageMetadata.sourceUrl")
        ),
        cardCount = response.requireCloudInt("cardCount", "$fieldPath.cardCount"),
        tagCounts = parseWorkspacePackageImportTagCounts(
            tagCounts = response.requireCloudArray("tagCounts", "$fieldPath.tagCounts"),
            fieldPath = "$fieldPath.tagCounts"
        ),
        referencedMediaCount = response.requireCloudInt("referencedMediaCount", "$fieldPath.referencedMediaCount"),
        packageMediaFileCount = response.requireCloudInt("packageMediaFileCount", "$fieldPath.packageMediaFileCount"),
        warnings = parseWorkspacePackageImportWarnings(
            warnings = response.requireCloudArray("warnings", "$fieldPath.warnings"),
            fieldPath = "$fieldPath.warnings"
        ),
        defaultOptions = WorkspacePackageImportDefaultOptions(
            addImportTag = defaultOptions.requireCloudBoolean(
                "addImportTag",
                "$fieldPath.defaultOptions.addImportTag"
            ),
            suggestedImportTag = defaultOptions.requireCloudString(
                "suggestedImportTag",
                "$fieldPath.defaultOptions.suggestedImportTag"
            ),
            keptTags = defaultOptions.requireCloudArray(
                "keptTags",
                "$fieldPath.defaultOptions.keptTags"
            ).toCloudStringList("$fieldPath.defaultOptions.keptTags"),
            removedTags = defaultOptions.requireCloudArray(
                "removedTags",
                "$fieldPath.defaultOptions.removedTags"
            ).toCloudStringList("$fieldPath.defaultOptions.removedTags")
        )
    )
}

private fun parseWorkspacePackageImportSourceKind(
    rawValue: String,
    fieldPath: String
): WorkspacePackageImportSourceKind {
    return when (rawValue) {
        "zip" -> WorkspacePackageImportSourceKind.ZIP
        else -> throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: expected known import source kind, got invalid string \"$rawValue\""
        )
    }
}

private fun parseWorkspacePackageImportTagCounts(
    tagCounts: JSONArray,
    fieldPath: String
): List<WorkspacePackageImportTagCount> {
    return buildList {
        for (index in 0 until tagCounts.length()) {
            val tagCount = tagCounts.requireCloudObject(index = index, fieldPath = "$fieldPath[$index]")
            add(
                WorkspacePackageImportTagCount(
                    tag = tagCount.requireCloudString("tag", "$fieldPath[$index].tag"),
                    cardsCount = tagCount.requireCloudInt("cardsCount", "$fieldPath[$index].cardsCount")
                )
            )
        }
    }
}

private fun parseWorkspacePackageImportWarnings(
    warnings: JSONArray,
    fieldPath: String
): List<WorkspacePackageImportWarning> {
    return buildList {
        for (index in 0 until warnings.length()) {
            val warning = warnings.requireCloudObject(index = index, fieldPath = "$fieldPath[$index]")
            add(
                WorkspacePackageImportWarning(
                    code = warning.requireCloudString("code", "$fieldPath[$index].code"),
                    message = warning.requireCloudString("message", "$fieldPath[$index].message"),
                    mediaPath = warning.requireCloudString("mediaPath", "$fieldPath[$index].mediaPath")
                )
            )
        }
    }
}

private fun parseWorkspacePackageImportConfirmSummary(
    summary: JSONObject,
    fieldPath: String
): WorkspacePackageImportConfirmSummary {
    return WorkspacePackageImportConfirmSummary(
        cardCount = summary.requireCloudInt("cardCount", "$fieldPath.cardCount"),
        cardBatchCount = summary.requireCloudInt("cardBatchCount", "$fieldPath.cardBatchCount"),
        referencedMediaCount = summary.requireCloudInt("referencedMediaCount", "$fieldPath.referencedMediaCount"),
        importedMediaAssetCount = summary.requireCloudInt(
            "importedMediaAssetCount",
            "$fieldPath.importedMediaAssetCount"
        ),
        appliedMediaAssetCount = summary.requireCloudInt("appliedMediaAssetCount", "$fieldPath.appliedMediaAssetCount"),
        keptTagCount = summary.requireCloudInt("keptTagCount", "$fieldPath.keptTagCount"),
        removedTagCount = summary.requireCloudInt("removedTagCount", "$fieldPath.removedTagCount"),
        importTag = summary.requireCloudNullableString("importTag", "$fieldPath.importTag")
    )
}
