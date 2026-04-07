package com.flashcardsopensourceapp.data.local.cloud

import org.json.JSONObject

internal fun JSONObject.putNullableString(key: String, value: String?): JSONObject {
    return put(key, value ?: JSONObject.NULL)
}

internal fun JSONObject.putNullableInt(key: String, value: Int?): JSONObject {
    return put(key, value ?: JSONObject.NULL)
}

internal fun JSONObject.putNullableDouble(key: String, value: Double?): JSONObject {
    return put(key, value ?: JSONObject.NULL)
}
