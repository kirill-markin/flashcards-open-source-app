package com.flashcardsopensourceapp.data.local.model.cards

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

fun normalizeCardType(rawValue: String): String {
    val trimmedValue: String = rawValue.trim()
    return if (trimmedValue.isEmpty()) {
        defaultCardType
    } else {
        trimmedValue
    }
}

fun makeDefaultCardSourceMetadata(createdAt: String): CardSourceMetadata {
    return CardSourceMetadata(
        label = null,
        author = null,
        comment = null,
        createdAt = createdAt,
        importedAt = null,
        importId = null
    )
}

fun makeDefaultCardMetadata(createdAt: String): CardMetadata {
    return CardMetadata(
        version = 1,
        source = makeDefaultCardSourceMetadata(createdAt = createdAt)
    )
}

fun encodeCardMetadataJson(metadata: CardMetadata): String {
    return buildCardMetadataJsonObject(metadata = metadata).toString()
}

fun encodeDefaultCardMetadataJson(createdAt: String): String {
    return encodeCardMetadataJson(metadata = makeDefaultCardMetadata(createdAt = createdAt))
}

fun buildCardMetadataJsonObject(metadata: CardMetadata): JSONObject {
    val result = JSONObject()
        .put("version", metadata.version)
        .put("source", metadata.source?.let(::buildCardSourceMetadataJsonObject) ?: JSONObject.NULL)
    metadata.onboardingDemo?.let { demo ->
        result.put("onboardingDemo", JSONObject()
            .put("version", demo.version)
            .put("frontText", demo.frontText)
            .put("backText", demo.backText)
            .put("tags", JSONArray(demo.tags))
            .put("cardType", demo.cardType)
            .put("wasEdited", demo.wasEdited))
    }
    return result
}

fun decodeCardMetadataJson(metadataJson: String): CardMetadata {
    val metadataObject: JSONObject = try {
        JSONObject(metadataJson)
    } catch (error: JSONException) {
        throw IllegalArgumentException("Card metadataJson must be a JSON object.", error)
    }

    return decodeCardMetadataJsonObject(metadataObject = metadataObject)
}

fun decodeCardMetadataJsonObject(metadataObject: JSONObject): CardMetadata {
    require(metadataObject.has("version")) {
        "Card metadata version is required."
    }
    val version: Int = metadataObject.getInt("version")
    require(version == 1) {
        "Card metadata version must be 1."
    }
    require(metadataObject.has("source")) {
        "Card metadata source is required."
    }

    return CardMetadata(
        version = version,
        source = if (metadataObject.isNull("source")) {
            null
        } else {
            decodeCardSourceMetadataJsonObject(metadataObject = metadataObject.getJSONObject("source"))
        },
        onboardingDemo = decodeOnboardingDemoMetadata(value = metadataObject.opt("onboardingDemo"))
    )
}

private fun buildCardSourceMetadataJsonObject(metadata: CardSourceMetadata): JSONObject {
    return JSONObject()
        .putNullableString("label", metadata.label)
        .putNullableString("author", metadata.author)
        .putNullableString("comment", metadata.comment)
        .putNullableString("createdAt", metadata.createdAt)
        .putNullableString("importedAt", metadata.importedAt)
        .putNullableString("importId", metadata.importId)
}

private fun decodeCardSourceMetadataJsonObject(metadataObject: JSONObject): CardSourceMetadata {
    return CardSourceMetadata(
        label = metadataObject.requireNullableString(key = "label"),
        author = metadataObject.requireNullableString(key = "author"),
        comment = metadataObject.requireNullableString(key = "comment"),
        createdAt = metadataObject.requireNullableString(key = "createdAt"),
        importedAt = metadataObject.requireNullableString(key = "importedAt"),
        importId = metadataObject.requireNullableString(key = "importId")
    )
}

private fun JSONObject.putNullableString(key: String, value: String?): JSONObject {
    return put(key, value ?: JSONObject.NULL)
}

private fun JSONObject.requireNullableString(key: String): String? {
    require(has(key)) {
        "Card metadata source $key is required."
    }
    val value = get(key)
    return when {
        value === JSONObject.NULL -> null
        value is String -> value
        else -> throw IllegalArgumentException("Card metadata source $key must be a string or null.")
    }
}

private val onboardingWhitespace: Set<Char> = setOf(
    '\u0009', '\u000A', '\u000B', '\u000C', '\u000D', '\u0020', '\u00A0', '\u1680',
    '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005', '\u2006', '\u2007',
    '\u2008', '\u2009', '\u200A', '\u2028', '\u2029', '\u202F', '\u205F', '\u3000', '\uFEFF'
)

private fun trimOnboardingText(text: String): String = text.trim { it in onboardingWhitespace }

fun makeOnboardingDemoMetadata(
    frontText: String,
    backText: String,
    tags: List<String>,
    cardType: String,
    wasEdited: Boolean
): OnboardingDemoMetadata {
    val trimmedType = trimOnboardingText(cardType)
    return OnboardingDemoMetadata(
        version = 1,
        frontText = trimOnboardingText(frontText),
        backText = trimOnboardingText(backText),
        tags = tags.distinct().sorted(),
        cardType = trimmedType.ifEmpty { defaultCardType },
        wasEdited = wasEdited
    )
}

fun decodeOnboardingDemoMetadata(value: Any?): OnboardingDemoMetadata? {
    val demo = value as? JSONObject ?: return null
    val version = demo.opt("version")
    val front = demo.opt("frontText") as? String ?: return null
    val back = demo.opt("backText") as? String ?: return null
    val type = demo.opt("cardType") as? String ?: return null
    val tags = demo.opt("tags") as? JSONArray ?: return null
    val wasEdited = if (demo.has("wasEdited")) demo.opt("wasEdited") as? Boolean ?: return null else false
    if (version !is Number || version.toDouble() != 1.0 || trimOnboardingText(front).isEmpty()) {
        return null
    }
    val tagValues = (0 until tags.length()).map { index -> tags.opt(index) as? String ?: return null }
    return makeOnboardingDemoMetadata(
        frontText = front, backText = back, tags = tagValues, cardType = type, wasEdited = wasEdited
    )
}

fun cardMetadataAfterAuthoredEdit(
    metadata: CardMetadata,
    frontText: String,
    backText: String,
    tags: List<String>,
    cardType: String,
    input: CardDraft
): CardMetadata {
    val demo = metadata.onboardingDemo ?: return metadata
    val previous = makeOnboardingDemoMetadata(
        frontText = frontText, backText = backText, tags = tags, cardType = cardType, wasEdited = false
    )
    val next = makeOnboardingDemoMetadata(
        frontText = input.frontText, backText = input.backText, tags = input.tags,
        cardType = cardType, wasEdited = false
    )
    return metadata.copy(onboardingDemo = demo.copy(
        wasEdited = demo.wasEdited || previous != next || demo.copy(wasEdited = false) != next
    ))
}
