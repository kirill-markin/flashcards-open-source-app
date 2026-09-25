package com.flashcardsopensourceapp.data.local.ai.wire

import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudInt
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudIsoTimestampMillis
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudNullableInt
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudObject
import com.flashcardsopensourceapp.data.local.model.ai.AiUsageStatus
import org.json.JSONObject

internal fun decodeAiUsageStatus(payload: String): AiUsageStatus {
    val usage = JSONObject(payload).requireCloudObject(key = "usage", fieldPath = "aiUsage.usage")
    return AiUsageStatus(
        monthEndsAtMillis = usage.requireCloudIsoTimestampMillis(
            key = "monthEndsAt",
            fieldPath = "aiUsage.usage.monthEndsAt"
        ),
        remainingMessages = usage.requireCloudNullableInt(
            key = "remainingMessages",
            fieldPath = "aiUsage.usage.remainingMessages"
        ),
        ownKeyMessages = usage.requireCloudInt(
            key = "ownKeyMessages",
            fieldPath = "aiUsage.usage.ownKeyMessages"
        )
    )
}
