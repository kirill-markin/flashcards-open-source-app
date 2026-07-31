package com.flashcardsopensourceapp.data.local.model.media

private const val managedMediaAssetSchemePrefix: String = "fcasset:"
private const val managedImageFallbackAltText: String = "Image"
private val managedMediaAssetReferenceRegex: Regex = Regex("""fcasset:([^\s)]+)""")

enum class ManagedMediaReferenceState {
    READY,
    PENDING,
    FAILED
}

data class ManagedMediaReference(
    val mediaAssetId: String,
    val state: ManagedMediaReferenceState
)

fun managedImageMarkdownReference(
    mediaAssetId: String,
    altText: String
): String {
    val normalizedMediaAssetId: String = normalizeManagedMediaAssetId(mediaAssetId = mediaAssetId)
    val normalizedAltText: String = normalizeManagedMediaLabel(label = altText)
    return "![$normalizedAltText]($managedMediaAssetSchemePrefix$normalizedMediaAssetId)"
}

fun extractManagedMediaAssetReferences(markdown: String): Set<String> {
    return managedMediaAssetReferenceRegex
        .findAll(input = markdown)
        .mapNotNull { matchResult ->
            parseManagedMediaReference(reference = matchResult.value)?.mediaAssetId
        }
        .toSet()
}

fun parseManagedMediaReference(reference: String): ManagedMediaReference? {
    val normalizedReference: String = reference.trim()
    if (normalizedReference.startsWith(prefix = managedMediaAssetSchemePrefix, ignoreCase = true).not()) {
        return null
    }

    val rawReference: String = normalizedReference
        .drop(n = managedMediaAssetSchemePrefix.length)
        .trimStart('/')
        .substringBefore(delimiter = "#")
    val mediaAssetId: String = rawReference.substringBefore(delimiter = "?").trim()
    if (mediaAssetId.isEmpty()) {
        return null
    }

    val state: ManagedMediaReferenceState = parseManagedMediaReferenceState(
        query = rawReference.substringAfter(delimiter = "?", missingDelimiterValue = "")
    )
    return ManagedMediaReference(
        mediaAssetId = mediaAssetId,
        state = state
    )
}

private fun parseManagedMediaReferenceState(query: String): ManagedMediaReferenceState {
    val stateValues: List<String> = query
        .split("&")
        .mapNotNull { queryPart ->
            val parameterName: String = queryPart.substringBefore(delimiter = "=")
            if (parameterName != "state") {
                return@mapNotNull null
            }
            queryPart.substringAfter(delimiter = "=", missingDelimiterValue = "")
        }
    return when (stateValues.singleOrNull()) {
        "pending" -> ManagedMediaReferenceState.PENDING
        "failed" -> ManagedMediaReferenceState.FAILED
        else -> ManagedMediaReferenceState.READY
    }
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
