package com.flashcardsopensourceapp.app.marketing.screenshots

import androidx.test.platform.app.InstrumentationRegistry
import java.io.IOException
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

private val marketingScreenshotFixtureLocales: Map<String, String> = mapOf(
    "bg" to "bg",
    "bn-BD" to "bn",
    "ca" to "ca",
    "cs-CZ" to "cs",
    "da-DK" to "da",
    "el-GR" to "el",
    "et" to "et",
    "fa" to "fa",
    "fi-FI" to "fi",
    "gu" to "gu",
    "iw-IL" to "he",
    "hr" to "hr",
    "hu-HU" to "hu",
    "id" to "id",
    "is-IS" to "is",
    "it-IT" to "it",
    "kn-IN" to "kn",
    "ko-KR" to "ko",
    "lt" to "lt",
    "lv" to "lv",
    "ml-IN" to "ml",
    "mr-IN" to "mr",
    "nl-NL" to "nl",
    "no-NO" to "no",
    "pa" to "pa",
    "pl-PL" to "pl",
    "ro" to "ro",
    "sk" to "sk",
    "sl" to "sl",
    "sv-SE" to "sv",
    "sw" to "sw",
    "ta-IN" to "ta",
    "te-IN" to "te",
    "th" to "th",
    "tr-TR" to "tr",
    "uk" to "uk",
    "ur" to "ur",
    "vi" to "vi",
    "zu" to "zu"
)

internal fun loadMarketingScreenshotLocaleConfig(localePrefix: String): MarketingScreenshotLocaleConfig {
    val expectedAppLocaleTag = marketingScreenshotFixtureLocales[localePrefix]
        ?: throw IllegalArgumentException("Unsupported marketing screenshot locale prefix '$localePrefix'.")
    val assetPath = "marketing-locales/$localePrefix.json"
    val fixtureText = try {
        InstrumentationRegistry.getInstrumentation().context.assets.open(assetPath).use { input ->
            input.reader(Charsets.UTF_8).readText()
        }
    } catch (exception: IOException) {
        throw IllegalStateException("Cannot read required screenshot fixture '$assetPath'.", exception)
    }

    val config = try {
        parseMarketingScreenshotLocaleConfig(fixture = JSONObject(fixtureText))
    } catch (exception: JSONException) {
        throw IllegalArgumentException("Invalid screenshot fixture '$assetPath': ${exception.message}", exception)
    }
    require(config.localePrefix == localePrefix) {
        "Screenshot fixture '$assetPath' must declare localePrefix '$localePrefix', got '${config.localePrefix}'."
    }
    require(config.appLocaleTag == expectedAppLocaleTag) {
        "Screenshot fixture '$assetPath' must declare appLocaleTag '$expectedAppLocaleTag', got '${config.appLocaleTag}'."
    }
    return config
}

private fun parseMarketingScreenshotLocaleConfig(fixture: JSONObject): MarketingScreenshotLocaleConfig {
    val uiText = fixture.getJSONObject("uiText")
    val reviewCard = fixture.getJSONObject("reviewCard")
    val tags = reviewCard.requiredNonemptyArray("tags")
    val cards = fixture.requiredNonemptyArray("cards")
    return MarketingScreenshotLocaleConfig(
        localePrefix = fixture.requiredText("localePrefix"),
        appLocaleTag = fixture.requiredText("appLocaleTag"),
        uiText = MarketingScreenshotUiText(
            emptyCardsMessage = uiText.requiredText("emptyCardsMessage"),
            cardsTabTitle = uiText.requiredText("cardsTabTitle"),
            reviewTabTitle = uiText.requiredText("reviewTabTitle"),
            aiTabTitle = uiText.requiredText("aiTabTitle"),
            searchCardsPlaceholder = uiText.requiredText("searchCardsPlaceholder"),
            addCardContentDescription = uiText.requiredText("addCardContentDescription"),
            frontFieldTitle = uiText.requiredText("frontFieldTitle"),
            backFieldTitle = uiText.requiredText("backFieldTitle"),
            tagsFieldTitle = uiText.requiredText("tagsFieldTitle"),
            addTagFieldTitle = uiText.requiredText("addTagFieldTitle"),
            addTagButtonTitle = uiText.requiredText("addTagButtonTitle"),
            saveButtonTitle = uiText.requiredText("saveButtonTitle"),
            ratingAgainTitle = uiText.requiredText("ratingAgainTitle"),
            ratingHardTitle = uiText.requiredText("ratingHardTitle"),
            ratingGoodTitle = uiText.requiredText("ratingGoodTitle"),
            ratingEasyTitle = uiText.requiredText("ratingEasyTitle")
        ),
        reviewCard = MarketingReviewCardFixture(
            frontText = reviewCard.requiredText("frontText"),
            backText = reviewCard.requiredText("backText"),
            tags = List(tags.length()) { index ->
                val tag = tags.get(index)
                if (tag !is String || tag.isBlank()) {
                    throw JSONException("reviewCard.tags[$index] must be a nonblank string.")
                }
                tag
            }
        ),
        reviewAiDraftMessage = fixture.requiredText("reviewAiDraftMessage"),
        cards = List(cards.length()) { index ->
            val card = cards.getJSONObject(index)
            MarketingConceptCard(
                frontText = card.requiredText("frontText"),
                backText = card.requiredText("backText"),
                subjectTag = card.requiredText("subjectTag")
            )
        }
    )
}

private fun JSONObject.requiredText(name: String): String {
    val value = get(name)
    if (value !is String || value.isBlank()) {
        throw JSONException("$name must be a nonblank string.")
    }
    return value
}

private fun JSONObject.requiredNonemptyArray(name: String): JSONArray {
    val value = getJSONArray(name)
    if (value.length() == 0) {
        throw JSONException("$name must be a nonempty array.")
    }
    return value
}
