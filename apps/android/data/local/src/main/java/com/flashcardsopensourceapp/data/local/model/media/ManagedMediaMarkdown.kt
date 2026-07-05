package com.flashcardsopensourceapp.data.local.model.media

private const val managedMediaAssetSchemePrefix: String = "fcasset:"
private const val managedImageFallbackAltText: String = "Image"

fun managedImageMarkdownReference(
    mediaAssetId: String,
    altText: String
): String {
    val normalizedMediaAssetId: String = normalizeManagedMediaAssetId(mediaAssetId = mediaAssetId)
    val normalizedAltText: String = normalizeManagedMediaLabel(label = altText)
    return "![$normalizedAltText]($managedMediaAssetSchemePrefix$normalizedMediaAssetId)"
}

private fun normalizeManagedMediaAssetId(mediaAssetId: String): String {
    val normalizedMediaAssetId: String = mediaAssetId.trim()
    require(normalizedMediaAssetId.isNotBlank()) {
        "Managed media asset id must not be blank."
    }
    require(normalizedMediaAssetId.none { character -> character.isWhitespace() }) {
        "Managed media asset id must not contain whitespace."
    }
    require(normalizedMediaAssetId.contains(')').not()) {
        "Managed media asset id must not contain a closing parenthesis."
    }
    return normalizedMediaAssetId
}

private fun normalizeManagedMediaLabel(label: String): String {
    val normalizedLabel: String = label
        .replace(oldChar = '[', newChar = '(')
        .replace(oldChar = ']', newChar = ')')
        .lineSequence()
        .joinToString(separator = " ") { line -> line.trim() }
        .trim()
    return normalizedLabel.ifBlank { managedImageFallbackAltText }
}
