package com.flashcardsopensourceapp.data.local.cloud.remote.workspace

import com.flashcardsopensourceapp.data.local.cloud.remote.transport.CloudJsonHttpClient
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.buildWorkspacePackageImportCloudPath
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.buildWorkspacePackageImportPreviewCloudPath
import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudArray
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudBoolean
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudInt
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudNullableString
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudObject
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudString
import com.flashcardsopensourceapp.data.local.cloud.wire.toCloudStringList
import com.flashcardsopensourceapp.data.local.model.cloud.formatIsoTimestamp
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

private const val workspacePackageImportFileFieldName: String = "file"
private const val workspacePackageImportOptionsFieldName: String = "options"

internal class CloudWorkspacePackageRemoteApi(
    private val httpClient: CloudJsonHttpClient
) {
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
