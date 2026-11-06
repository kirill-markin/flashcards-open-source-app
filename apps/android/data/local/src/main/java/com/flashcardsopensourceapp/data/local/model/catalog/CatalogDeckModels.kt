package com.flashcardsopensourceapp.data.local.model.catalog

data class CatalogDeckCardPreview(
    val ordinal: Int,
    val frontText: String,
    val backText: String
)

/** The deck page content the browse index does not carry, for one published package version. */
data class CatalogDeckPage(
    val packageVersionId: String,
    val description: String,
    /** The package's newest published version; it differs from [packageVersionId] once the index is stale. */
    val latestPackageVersionId: String,
    val cards: List<CatalogDeckCardPreview>
)

/** The server no longer publishes this catalog package or package version. */
class CatalogDeckUnavailableException(
    message: String,
    cause: Throwable
) : IllegalStateException(message, cause)
