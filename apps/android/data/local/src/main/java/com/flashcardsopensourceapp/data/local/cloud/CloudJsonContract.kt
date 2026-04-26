package com.flashcardsopensourceapp.data.local.cloud

import com.flashcardsopensourceapp.data.local.model.parseIsoTimestamp
import org.json.JSONArray
import org.json.JSONObject

internal class CloudContractMismatchException(
    message: String,
    cause: Throwable? = null
) : IllegalStateException(message, cause)

internal fun JSONObject.requireCloudString(key: String, fieldPath: String): String {
    val value = requireCloudValue(key = key, fieldPath = fieldPath)
    return value as? String ?: throw cloudContractMismatch(
        fieldPath = fieldPath,
        expected = "string",
        actualValue = value
    )
}

internal fun JSONObject.requireCloudNullableString(key: String, fieldPath: String): String? {
    val value = requireCloudValue(key = key, fieldPath = fieldPath)
    return when {
        value === JSONObject.NULL -> null
        value is String -> value
        else -> throw cloudContractMismatch(
            fieldPath = fieldPath,
            expected = "string or null",
            actualValue = value
        )
    }
}

internal fun JSONObject.optCloudStringOrNull(key: String, fieldPath: String): String? {
    if (has(key).not()) {
        return null
    }
    return requireCloudNullableString(key = key, fieldPath = fieldPath)
}

internal fun JSONObject.requireCloudInt(key: String, fieldPath: String): Int {
    val value = requireCloudValue(key = key, fieldPath = fieldPath)
    return parseCloudInt(value = value, fieldPath = fieldPath)
}

internal fun JSONObject.optCloudIntOrNull(key: String, fieldPath: String): Int? {
    if (has(key).not()) {
        return null
    }
    val value = requireCloudValue(key = key, fieldPath = fieldPath)
    if (value === JSONObject.NULL) {
        return null
    }
    return parseCloudInt(value = value, fieldPath = fieldPath)
}

internal fun JSONObject.requireCloudLong(key: String, fieldPath: String): Long {
    val value = requireCloudValue(key = key, fieldPath = fieldPath)
    return parseCloudLong(value = value, fieldPath = fieldPath)
}

internal fun JSONObject.optCloudLongOrNull(key: String, fieldPath: String): Long? {
    if (has(key).not()) {
        return null
    }
    val value = requireCloudValue(key = key, fieldPath = fieldPath)
    if (value === JSONObject.NULL) {
        return null
    }
    return parseCloudLong(value = value, fieldPath = fieldPath)
}

internal fun JSONObject.requireCloudDouble(key: String, fieldPath: String): Double {
    val value = requireCloudValue(key = key, fieldPath = fieldPath)
    return parseCloudDouble(value = value, fieldPath = fieldPath)
}

internal fun JSONObject.optCloudDoubleOrNull(key: String, fieldPath: String): Double? {
    if (has(key).not()) {
        return null
    }
    val value = requireCloudValue(key = key, fieldPath = fieldPath)
    if (value === JSONObject.NULL) {
        return null
    }
    return parseCloudDouble(value = value, fieldPath = fieldPath)
}

internal fun JSONObject.requireCloudBoolean(key: String, fieldPath: String): Boolean {
    val value = requireCloudValue(key = key, fieldPath = fieldPath)
    return value as? Boolean ?: throw cloudContractMismatch(
        fieldPath = fieldPath,
        expected = "boolean",
        actualValue = value
    )
}

internal fun JSONObject.optCloudBooleanOrNull(key: String, fieldPath: String): Boolean? {
    if (has(key).not()) {
        return null
    }
    val value = requireCloudValue(key = key, fieldPath = fieldPath)
    return when {
        value === JSONObject.NULL -> null
        value is Boolean -> value
        else -> throw cloudContractMismatch(
            fieldPath = fieldPath,
            expected = "boolean or null",
            actualValue = value
        )
    }
}

internal fun JSONObject.requireCloudObject(key: String, fieldPath: String): JSONObject {
    val value = requireCloudValue(key = key, fieldPath = fieldPath)
    return value as? JSONObject ?: throw cloudContractMismatch(
        fieldPath = fieldPath,
        expected = "object",
        actualValue = value
    )
}

internal fun JSONObject.optCloudObjectOrNull(key: String, fieldPath: String): JSONObject? {
    if (has(key).not()) {
        return null
    }
    val value = requireCloudValue(key = key, fieldPath = fieldPath)
    return when {
        value === JSONObject.NULL -> null
        value is JSONObject -> value
        else -> throw cloudContractMismatch(
            fieldPath = fieldPath,
            expected = "object or null",
            actualValue = value
        )
    }
}

internal fun JSONObject.requireCloudArray(key: String, fieldPath: String): JSONArray {
    val value = requireCloudValue(key = key, fieldPath = fieldPath)
    return value as? JSONArray ?: throw cloudContractMismatch(
        fieldPath = fieldPath,
        expected = "array",
        actualValue = value
    )
}

internal fun JSONObject.optCloudArrayOrNull(key: String, fieldPath: String): JSONArray? {
    if (has(key).not()) {
        return null
    }
    val value = requireCloudValue(key = key, fieldPath = fieldPath)
    return when {
        value === JSONObject.NULL -> null
        value is JSONArray -> value
        else -> throw cloudContractMismatch(
            fieldPath = fieldPath,
            expected = "array or null",
            actualValue = value
        )
    }
}

internal fun JSONObject.requireCloudIsoTimestampMillis(key: String, fieldPath: String): Long {
    return parseCloudIsoTimestamp(
        value = requireCloudString(key = key, fieldPath = fieldPath),
        fieldPath = fieldPath
    )
}

internal fun JSONObject.requireCloudNullableIsoTimestampMillis(key: String, fieldPath: String): Long? {
    val value = requireCloudNullableString(key = key, fieldPath = fieldPath)
    return value?.let { rawValue ->
        parseCloudIsoTimestamp(value = rawValue, fieldPath = fieldPath)
    }
}

internal fun JSONArray.requireCloudObject(index: Int, fieldPath: String): JSONObject {
    val value = requireCloudValue(index = index, fieldPath = fieldPath)
    return value as? JSONObject ?: throw cloudContractMismatch(
        fieldPath = fieldPath,
        expected = "object",
        actualValue = value
    )
}

internal fun JSONArray.requireCloudString(index: Int, fieldPath: String): String {
    val value = requireCloudValue(index = index, fieldPath = fieldPath)
    return value as? String ?: throw cloudContractMismatch(
        fieldPath = fieldPath,
        expected = "string",
        actualValue = value
    )
}

internal fun JSONArray.requireCloudInt(index: Int, fieldPath: String): Int {
    val value = requireCloudValue(index = index, fieldPath = fieldPath)
    return parseCloudInt(value = value, fieldPath = fieldPath)
}

internal fun JSONArray.toCloudStringList(fieldPath: String): List<String> {
    return buildList {
        for (index in 0 until length()) {
            add(requireCloudString(index = index, fieldPath = "$fieldPath[$index]"))
        }
    }
}

internal fun JSONArray.toCloudIntList(fieldPath: String): List<Int> {
    return buildList {
        for (index in 0 until length()) {
            add(requireCloudInt(index = index, fieldPath = "$fieldPath[$index]"))
        }
    }
}

internal fun parseCloudIsoTimestamp(value: String, fieldPath: String): Long {
    return try {
        parseIsoTimestamp(value)
    } catch (error: IllegalArgumentException) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: expected ISO 8601 timestamp string, got invalid string \"$value\"",
            error
        )
    }
}

private fun JSONObject.requireCloudValue(key: String, fieldPath: String): Any {
    if (has(key).not()) {
        throw cloudContractMismatch(
            fieldPath = fieldPath,
            expected = "present value",
            actualValue = null
        )
    }
    return get(key)
}

private fun JSONArray.requireCloudValue(index: Int, fieldPath: String): Any {
    if (index < 0 || index >= length()) {
        throw cloudContractMismatch(
            fieldPath = fieldPath,
            expected = "present value",
            actualValue = null
        )
    }
    return get(index)
}

private fun parseCloudInt(value: Any, fieldPath: String): Int {
    if (value !is Number) {
        throw cloudContractMismatch(
            fieldPath = fieldPath,
            expected = "integer",
            actualValue = value
        )
    }

    val longValue = value.toLong()
    val doubleValue = value.toDouble()
    if (doubleValue != longValue.toDouble()) {
        throw cloudContractMismatch(
            fieldPath = fieldPath,
            expected = "integer",
            actualValue = value
        )
    }
    if (longValue < Int.MIN_VALUE || longValue > Int.MAX_VALUE) {
        throw cloudContractMismatch(
            fieldPath = fieldPath,
            expected = "integer",
            actualValue = value
        )
    }
    return longValue.toInt()
}

private fun parseCloudLong(value: Any, fieldPath: String): Long {
    if (value !is Number) {
        throw cloudContractMismatch(
            fieldPath = fieldPath,
            expected = "integer",
            actualValue = value
        )
    }

    val longValue = value.toLong()
    if (value.toDouble() != longValue.toDouble()) {
        throw cloudContractMismatch(
            fieldPath = fieldPath,
            expected = "integer",
            actualValue = value
        )
    }
    return longValue
}

private fun parseCloudDouble(value: Any, fieldPath: String): Double {
    if (value !is Number) {
        throw cloudContractMismatch(
            fieldPath = fieldPath,
            expected = "number",
            actualValue = value
        )
    }
    return value.toDouble()
}

private fun cloudContractMismatch(
    fieldPath: String,
    expected: String,
    actualValue: Any?
): CloudContractMismatchException {
    return CloudContractMismatchException(
        "Cloud contract mismatch for $fieldPath: expected $expected, got ${describeCloudJsonType(actualValue = actualValue)}"
    )
}

private fun describeCloudJsonType(actualValue: Any?): String {
    return when (actualValue) {
        null -> "missing"
        JSONObject.NULL -> "null"
        is String -> "string"
        is Boolean -> "boolean"
        is Int, is Long, is Short, is Byte -> "integer"
        is Float, is Double -> "number"
        is Number -> "number"
        is JSONObject -> "object"
        is JSONArray -> "array"
        else -> actualValue::class.java.simpleName
    }
}
