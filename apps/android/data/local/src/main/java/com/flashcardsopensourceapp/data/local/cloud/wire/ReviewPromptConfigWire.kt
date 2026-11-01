package com.flashcardsopensourceapp.data.local.cloud.wire

import com.flashcardsopensourceapp.data.local.review.prompts.ReviewPromptConfig
import com.flashcardsopensourceapp.data.local.review.prompts.ReviewPromptId
import com.flashcardsopensourceapp.data.local.review.prompts.ReviewPromptSettings
import org.json.JSONArray
import org.json.JSONObject

/*
 Reads `reviewPrompts` from GET /me, shaped and ruled by apps/backend/src/reviewPrompts/reviewPromptConfig.ts.
 The cached copy uses the same shape, so one decoder reads both.
 */

private const val supportedReviewPromptConfigSchemaVersion: Int = 1

// Same as `productAnalyticsReviewPromptConfigVersionPattern` in
// apps/backend/src/productAnalytics/catalog.ts, because `version` is sent as `review_prompt_config_version`.
private val reviewPromptConfigVersionPattern: Regex = Regex(pattern = "^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$")

private const val enabledSettingKey: String = "enabled"
private const val minTotalReviewsSettingKey: String = "minTotalReviews"
private const val minReviewsTodaySettingKey: String = "minReviewsToday"
private const val minReviewDaysSettingKey: String = "minReviewDays"
private const val cooldownDaysSettingKey: String = "cooldownDays"
private val knownReviewPromptSettingKeys: Set<String> = setOf(
    enabledSettingKey,
    minTotalReviewsSettingKey,
    minReviewsTodaySettingKey,
    minReviewDaysSettingKey,
    cooldownDaysSettingKey
)

// Released app builds reject paywall state with a second-paywall showing and no initial one, so
// while they are in use a remote config must not disable `paywall-initial` or order it after `paywall-second`.
internal fun parseReviewPromptConfig(json: JSONObject, fieldPath: String): ReviewPromptConfig {
    val schemaVersion: Int = json.requireCloudInt("schemaVersion", "$fieldPath.schemaVersion")
    if (schemaVersion != supportedReviewPromptConfigSchemaVersion) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath.schemaVersion: expected $supportedReviewPromptConfigSchemaVersion, got $schemaVersion"
        )
    }
    val version: String = json.requireCloudString("version", "$fieldPath.version")
    if (reviewPromptConfigVersionPattern.matches(input = version).not()) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath.version: expected ${reviewPromptConfigVersionPattern.pattern}, got \"$version\""
        )
    }
    val promptsJson: JSONObject = json.requireCloudObject("prompts", "$fieldPath.prompts")
    val prompts: Map<ReviewPromptId, ReviewPromptSettings> = ReviewPromptId.entries
        .filter { promptId -> promptsJson.has(promptId.wireValue) }
        .associateWith { promptId ->
            parseReviewPromptSettings(
                json = promptsJson.requireCloudObject(promptId.wireValue, "$fieldPath.prompts.${promptId.wireValue}"),
                fieldPath = "$fieldPath.prompts.${promptId.wireValue}"
            )
        }
    val order: List<ReviewPromptId> = json.requireCloudArray("order", "$fieldPath.order")
        .toCloudStringList(fieldPath = "$fieldPath.order")
        .mapNotNull { wireValue -> ReviewPromptId.entries.firstOrNull { promptId -> promptId.wireValue == wireValue } }
    return ReviewPromptConfig(
        schemaVersion = schemaVersion,
        version = version,
        order = order,
        prompts = prompts
    )
}

internal fun encodeReviewPromptConfig(config: ReviewPromptConfig): JSONObject {
    val prompts = JSONObject()
    config.prompts.forEach { (promptId, settings) ->
        prompts.put(promptId.wireValue, encodeReviewPromptSettings(settings = settings))
    }
    return JSONObject()
        .put("schemaVersion", config.schemaVersion)
        .put("version", config.version)
        .put("order", JSONArray(config.order.map(ReviewPromptId::wireValue)))
        .put("prompts", prompts)
}

/** A prompt with a setting this app does not understand is disabled rather than shown under rules it cannot apply. */
private fun parseReviewPromptSettings(json: JSONObject, fieldPath: String): ReviewPromptSettings {
    val enabled: Boolean = json.requireCloudBoolean(enabledSettingKey, "$fieldPath.$enabledSettingKey")
    val hasUnknownSetting: Boolean = json.keys().asSequence().any { key -> key !in knownReviewPromptSettingKeys }
    return ReviewPromptSettings(
        enabled = enabled && hasUnknownSetting.not(),
        minTotalReviews = optReviewPromptCount(json = json, key = minTotalReviewsSettingKey, fieldPath = fieldPath),
        minReviewsToday = optReviewPromptCount(json = json, key = minReviewsTodaySettingKey, fieldPath = fieldPath),
        minReviewDays = optReviewPromptCount(json = json, key = minReviewDaysSettingKey, fieldPath = fieldPath),
        cooldownDays = optReviewPromptCount(json = json, key = cooldownDaysSettingKey, fieldPath = fieldPath)
    )
}

private fun optReviewPromptCount(json: JSONObject, key: String, fieldPath: String): Int? {
    if (json.has(key).not()) {
        return null
    }
    val count: Int = json.requireCloudInt(key, "$fieldPath.$key")
    if (count < 0) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath.$key: expected non-negative integer, got $count"
        )
    }
    return count
}

private fun encodeReviewPromptSettings(settings: ReviewPromptSettings): JSONObject {
    val json = JSONObject().put(enabledSettingKey, settings.enabled)
    settings.minTotalReviews?.let { count -> json.put(minTotalReviewsSettingKey, count) }
    settings.minReviewsToday?.let { count -> json.put(minReviewsTodaySettingKey, count) }
    settings.minReviewDays?.let { count -> json.put(minReviewDaysSettingKey, count) }
    settings.cooldownDays?.let { count -> json.put(cooldownDaysSettingKey, count) }
    return json
}
