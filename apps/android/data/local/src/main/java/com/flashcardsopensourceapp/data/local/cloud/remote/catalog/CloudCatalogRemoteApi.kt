package com.flashcardsopensourceapp.data.local.cloud.remote.catalog

import com.flashcardsopensourceapp.data.local.cloud.remote.transport.CloudJsonHttpClient
import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException
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
import org.json.JSONException
import org.json.JSONObject

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
