package com.flashcardsopensourceapp.data.local.model.catalog

/** `sha256` names the decompressed index bytes behind `url`; it changes on every catalog refresh. */
data class CatalogBrowseIndexPointer(
    val url: String,
    val sha256: String,
    val generatedAt: String
)

data class CatalogBrowseIndexDeck(
    val packageId: String,
    val packageVersionId: String,
    val slug: String,
    val title: String,
    val summary: String,
    val languageTags: List<String>,
    val educationalSubject: String,
    val cardCount: Int,
    val publishedAtMillis: Long,
    val authorDisplayName: String,
    val coverImageUrl: String?,
    val reviewTag: String
)

data class CatalogBrowseIndex(
    val generatedAt: String,
    val decks: List<CatalogBrowseIndexDeck>
)

sealed interface CatalogBrowseIndexCacheState {
    /** The on-device cache has not been read yet. */
    data object Loading : CatalogBrowseIndexCacheState

    /** No index is cached on this device yet. */
    data object Empty : CatalogBrowseIndexCacheState

    data class Ready(val index: CatalogBrowseIndex) : CatalogBrowseIndexCacheState
}
