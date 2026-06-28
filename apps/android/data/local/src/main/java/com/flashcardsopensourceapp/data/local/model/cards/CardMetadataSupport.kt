package com.flashcardsopensourceapp.data.local.model.cards

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
    return JSONObject()
        .put("version", metadata.version)
        .put("source", metadata.source?.let(::buildCardSourceMetadataJsonObject) ?: JSONObject.NULL)
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
        }
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
