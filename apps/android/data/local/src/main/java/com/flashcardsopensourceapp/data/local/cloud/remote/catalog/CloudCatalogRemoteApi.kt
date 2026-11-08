package com.flashcardsopensourceapp.data.local.cloud.remote.catalog

import android.util.Log
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.CloudJsonHttpClient
import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.cloud.wire.optCloudObjectOrNull
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudArray
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudInt
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudIsoTimestampMillis
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudNullableString
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudObject
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudString
import com.flashcardsopensourceapp.data.local.cloud.wire.toCloudStringList
import com.flashcardsopensourceapp.data.local.model.catalog.CatalogBrowseIndex
import com.flashcardsopensourceapp.data.local.model.catalog.CatalogBrowseIndexDeck
import com.flashcardsopensourceapp.data.local.model.catalog.CatalogBrowseIndexPointer
import com.flashcardsopensourceapp.data.local.model.catalog.CatalogDeckCardPreview
import com.flashcardsopensourceapp.data.local.model.catalog.CatalogDeckPage
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

private const val catalogDeckPageLogTag: String = "CatalogDeckPage"
private const val catalogBrowseIndexPointerPath: String = "/catalog/browse-index"
private const val supportedCatalogBrowseIndexSchemaVersion: Int = 1
private val catalogBrowseIndexSha256Pattern: Regex = Regex("^[0-9a-f]{64}$")

internal class CloudCatalogRemoteApi(
    private val httpClient: CloudJsonHttpClient
) {
    suspend fun loadBrowseIndexPointer(apiBaseUrl: String): CatalogBrowseIndexPointer {
        val response = httpClient.getJson(
            baseUrl = apiBaseUrl,
            path = catalogBrowseIndexPointerPath,
            authorizationHeader = null
        )
        return parseCatalogBrowseIndexPointer(response = response)
    }

    /** The raw `GET /catalog/packages/{slug}` body, kept unparsed so the deck page cache stores the server's own answer. */
    suspend fun loadPackageDetailResponse(apiBaseUrl: String, packageSlug: String): JSONObject {
        return httpClient.getJson(
            baseUrl = apiBaseUrl,
            path = "/catalog/packages/${encodeCatalogPathSegment(value = packageSlug)}",
            authorizationHeader = null
        )
    }

    /** The raw `GET /catalog/package-versions/{id}/cards` body; see [loadPackageDetailResponse]. */
    suspend fun loadCardPreviewResponse(apiBaseUrl: String, packageVersionId: String, limit: Int): JSONObject {
        return httpClient.getJson(
            baseUrl = apiBaseUrl,
            path = "/catalog/package-versions/${encodeCatalogPathSegment(value = packageVersionId)}/cards?limit=$limit",
            authorizationHeader = null
        )
    }

    suspend fun loadInstallContext(
        apiBaseUrl: String,
        authorizationHeader: String,
        packageVersionId: String
    ): List<CatalogPackageInstallWorkspaceState> {
        val response = httpClient.getJson(
            baseUrl = apiBaseUrl,
            path = "/catalog/package-versions/${encodeCatalogPathSegment(value = packageVersionId)}/install-context",
            authorizationHeader = authorizationHeader
        )
        return parseCatalogPackageInstallContext(response = response)
    }

    suspend fun installPackageVersion(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        packageVersionId: String,
        request: CatalogPackageInstallRequest
    ) {
        val response = httpClient.postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/${encodeCatalogPathSegment(value = workspaceId)}/catalog/package-versions/" +
                "${encodeCatalogPathSegment(value = packageVersionId)}/install",
            authorizationHeader = authorizationHeader,
            body = JSONObject()
                .put("installId", request.installId)
                .put("installedAt", request.installedAt)
                .put("clientUpdatedAt", request.clientUpdatedAt)
                .put("lastModifiedByReplicaId", request.lastModifiedByReplicaId)
                .put("operationIdPrefix", request.installId)
                .put("addImportTag", false)
                .put("removeTags", JSONArray())
        )
        val installedPackageVersionId = response
            .requireCloudObject("packageVersion", "catalogPackageInstall.packageVersion")
            .requireCloudString("packageVersionId", "catalogPackageInstall.packageVersion.packageVersionId")
        val installId = response
            .requireCloudObject("summary", "catalogPackageInstall.summary")
            .requireCloudString("installId", "catalogPackageInstall.summary.installId")
        if (installedPackageVersionId != packageVersionId || installId != request.installId) {
            throw CloudContractMismatchException(
                "Cloud contract mismatch for catalogPackageInstall: expected packageVersionId=$packageVersionId " +
                    "installId=${request.installId}, got packageVersionId=$installedPackageVersionId installId=$installId"
            )
        }
    }
}

internal data class CatalogPackageInstallWorkspaceState(
    val workspaceId: String,
    val previousInstallId: String?
)

/** `operationIdPrefix` is the `installId`, and the deck installs with its own tags and no import tag. */
internal data class CatalogPackageInstallRequest(
    val installId: String,
    val installedAt: String,
    val clientUpdatedAt: String,
    val lastModifiedByReplicaId: String
)

private fun encodeCatalogPathSegment(value: String): String {
    return URLEncoder.encode(value, StandardCharsets.UTF_8.name()).replace("+", "%20")
}

private fun parseCatalogPackageInstallContext(response: JSONObject): List<CatalogPackageInstallWorkspaceState> {
    val workspaces = response.requireCloudArray("workspaces", "catalogPackageInstallContext.workspaces")
    return (0 until workspaces.length()).map { index ->
        val fieldPath = "catalogPackageInstallContext.workspaces[$index]"
        val workspace = workspaces.requireCloudObject(index, fieldPath)
        if (workspace.has("previousInstall").not()) {
            throw CloudContractMismatchException("Cloud contract mismatch for $fieldPath.previousInstall: field is missing")
        }
        val previousInstall = workspace.optCloudObjectOrNull("previousInstall", "$fieldPath.previousInstall")
        CatalogPackageInstallWorkspaceState(
            workspaceId = workspace.requireCloudString("workspaceId", "$fieldPath.workspaceId"),
            previousInstallId = previousInstall?.requireCloudString("installId", "$fieldPath.previousInstall.installId")
        )
    }
}

/**
 * Builds the deck page for [packageVersionId] from the package detail and card preview bodies.
 * Throws [CloudContractMismatchException] when either body does not match the contract.
 */
internal fun parseCatalogDeckPage(
    packageVersionId: String,
    packageDetailResponse: JSONObject,
    cardPreviewResponse: JSONObject
): CatalogDeckPage {
    val catalogPackage = packageDetailResponse.requireCloudObject("catalogPackage", "catalogPackageDetail.catalogPackage")
    val latestVersion = catalogPackage.requireCloudObject(
        "latestVersion",
        "catalogPackageDetail.catalogPackage.latestVersion"
    )
    val previewPackageVersionId = cardPreviewResponse.requireCloudString(
        "packageVersionId",
        "catalogCardPreview.packageVersionId"
    )
    if (previewPackageVersionId != packageVersionId) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for catalogCardPreview.packageVersionId: " +
                "expected $packageVersionId, got $previewPackageVersionId"
        )
    }
    val cards = cardPreviewResponse.requireCloudArray("cards", "catalogCardPreview.cards")
    val downloadUrlsByMediaKey = parseCatalogMediaDownloadUrls(
        mediaAssets = catalogPackage.requireCloudArray("mediaAssets", "catalogPackageDetail.catalogPackage.mediaAssets")
    )
    val page = CatalogDeckPage(
        packageVersionId = packageVersionId,
        description = rewriteCatalogMediaReferences(
            text = catalogPackage.requireCloudString("description", "catalogPackageDetail.catalogPackage.description"),
            downloadUrlsByMediaKey = downloadUrlsByMediaKey
        ),
        latestPackageVersionId = latestVersion.requireCloudString(
            "packageVersionId",
            "catalogPackageDetail.catalogPackage.latestVersion.packageVersionId"
        ),
        cards = (0 until cards.length()).map { index ->
            val fieldPath = "catalogCardPreview.cards[$index]"
            val card = cards.requireCloudObject(index, fieldPath)
            CatalogDeckCardPreview(
                ordinal = card.requireCloudInt("ordinal", "$fieldPath.ordinal"),
                frontText = rewriteCatalogMediaReferences(
                    text = card.requireCloudString("frontText", "$fieldPath.frontText"),
                    downloadUrlsByMediaKey = downloadUrlsByMediaKey
                ),
                backText = rewriteCatalogMediaReferences(
                    text = card.requireCloudString("backText", "$fieldPath.backText"),
                    downloadUrlsByMediaKey = downloadUrlsByMediaKey
                )
            )
        }
    )
    val unpublishedMediaKeys = (listOf(page.description) + page.cards.flatMap { card -> listOf(card.frontText, card.backText) })
        .flatMap { text -> catalogMediaReferenceRegex.findAll(input = text).map { match -> match.groupValues[1] } }
        .toSortedSet()
    if (unpublishedMediaKeys.isNotEmpty()) {
        Log.w(
            catalogDeckPageLogTag,
            "event=catalog_deck_page_media_unpublished packageVersionId=$packageVersionId " +
                "packageMediaKeys=${unpublishedMediaKeys.joinToString(separator = ",")}"
        )
    }
    return page
}

/** Keys whose asset the public catalog never published have a null `downloadUrl` and are left out. */
private fun parseCatalogMediaDownloadUrls(mediaAssets: JSONArray): Map<String, String> {
    return (0 until mediaAssets.length()).mapNotNull { index ->
        val fieldPath = "catalogPackageDetail.catalogPackage.mediaAssets[$index]"
        val mediaAsset = mediaAssets.requireCloudObject(index, fieldPath)
        val downloadUrl = mediaAsset.requireCloudNullableString("downloadUrl", "$fieldPath.downloadUrl")
        downloadUrl?.let { url -> mediaAsset.requireCloudString("packageMediaKey", "$fieldPath.packageMediaKey") to url }
    }.toMap()
}

private val catalogMediaReferenceRegex: Regex = Regex("""fcasset:([A-Za-z0-9][A-Za-z0-9._-]*)""")

/**
 * Points catalog `fcasset:<packageMediaKey>` references at their published CDN objects, so the card
 * renderer shows them as linked images; a key without a published object stays as it is.
 */
private fun rewriteCatalogMediaReferences(text: String, downloadUrlsByMediaKey: Map<String, String>): String {
    return catalogMediaReferenceRegex.replace(input = text) { match ->
        downloadUrlsByMediaKey[match.groupValues[1]] ?: match.value
    }
}

internal fun parseCatalogBrowseIndexPointer(response: JSONObject): CatalogBrowseIndexPointer {
    val sha256 = response.requireCloudString("sha256", "catalogBrowseIndexPointer.sha256")
    if (catalogBrowseIndexSha256Pattern.matches(sha256).not()) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for catalogBrowseIndexPointer.sha256: " +
                "expected 64 lowercase hex characters, got \"$sha256\""
        )
    }
    return CatalogBrowseIndexPointer(
        url = response.requireCloudString("url", "catalogBrowseIndexPointer.url"),
        sha256 = sha256,
        generatedAt = response.requireCloudString("generatedAt", "catalogBrowseIndexPointer.generatedAt")
    )
}

internal fun parseCatalogBrowseIndex(json: String): CatalogBrowseIndex {
    val root = try {
        JSONObject(json)
    } catch (error: JSONException) {
        throw CloudContractMismatchException("Catalog browse index is not a JSON object.", error)
    }
    val schemaVersion = root.requireCloudInt("schemaVersion", "catalogBrowseIndex.schemaVersion")
    if (schemaVersion != supportedCatalogBrowseIndexSchemaVersion) {
        throw CloudContractMismatchException(
            "Catalog browse index schemaVersion $schemaVersion is not supported; " +
                "this app reads schemaVersion $supportedCatalogBrowseIndexSchemaVersion."
        )
    }
    val decks = root.requireCloudArray("decks", "catalogBrowseIndex.decks")
    return CatalogBrowseIndex(
        generatedAt = root.requireCloudString("generatedAt", "catalogBrowseIndex.generatedAt"),
        decks = (0 until decks.length()).map { index ->
            parseCatalogBrowseIndexDeck(
                deck = decks.requireCloudObject(index, "catalogBrowseIndex.decks[$index]"),
                fieldPath = "catalogBrowseIndex.decks[$index]"
            )
        }
    )
}

private fun parseCatalogBrowseIndexDeck(deck: JSONObject, fieldPath: String): CatalogBrowseIndexDeck {
    return CatalogBrowseIndexDeck(
        packageId = deck.requireCloudString("packageId", "$fieldPath.packageId"),
        packageVersionId = deck.requireCloudString("packageVersionId", "$fieldPath.packageVersionId"),
        slug = deck.requireCloudString("slug", "$fieldPath.slug"),
        title = deck.requireCloudString("title", "$fieldPath.title"),
        summary = deck.requireCloudString("summary", "$fieldPath.summary"),
        languageTags = deck.requireCloudArray("languageTags", "$fieldPath.languageTags")
            .toCloudStringList(fieldPath = "$fieldPath.languageTags"),
        educationalSubject = deck.requireCloudString("educationalSubject", "$fieldPath.educationalSubject"),
        cardCount = deck.requireCloudInt("cardCount", "$fieldPath.cardCount"),
        publishedAtMillis = deck.requireCloudIsoTimestampMillis("publishedAt", "$fieldPath.publishedAt"),
        authorDisplayName = deck.requireCloudString("authorDisplayName", "$fieldPath.authorDisplayName"),
        coverImageUrl = deck.requireCloudNullableString("coverImageUrl", "$fieldPath.coverImageUrl"),
        reviewTag = deck.requireCloudString("reviewTag", "$fieldPath.reviewTag")
    )
}
