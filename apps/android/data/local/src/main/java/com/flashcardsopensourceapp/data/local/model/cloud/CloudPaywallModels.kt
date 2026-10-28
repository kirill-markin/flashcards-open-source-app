package com.flashcardsopensourceapp.data.local.model.cloud

import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsReviewPaywallTrigger
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import org.json.JSONObject

data class CloudPaywallState(
    val introShownAt: Instant?,
    val introLocalDate: LocalDate?,
    val introTimeZone: String?,
    val followUpShownAt: Instant?,
    val lastShownAt: Instant?,
    val periodicShownAt: Instant?
)

val emptyCloudPaywallState = CloudPaywallState(null, null, null, null, null, null)

data class CloudPaywallImpression(
    val presentationId: String,
    val shownAt: Instant,
    val localDate: LocalDate,
    val timeZone: String,
    // Wire names from apps/backend/src/paywallState.ts: day3 is paywall-second, weekly is paywall-periodic.
    val reviewTrigger: AnalyticsReviewPaywallTrigger?
) {
    fun toJson(): JSONObject = JSONObject()
        .put("presentationId", presentationId)
        .put("shownAt", shownAt.toString())
        .put("localDate", localDate.toString())
        .put("timeZone", timeZone)
        .put("reviewTrigger", reviewTrigger?.wireValue ?: JSONObject.NULL)
}

fun parseCloudPaywallState(json: JSONObject): CloudPaywallState {
    val intro = json.nullablePaywallString("introShownAt")?.let(Instant::parse)
    val date = json.nullablePaywallString("introLocalDate")?.let(::parsePaywallDate)
    val zone = json.nullablePaywallString("introTimeZone")?.also(::requirePaywallZone)
    val followUp = json.nullablePaywallString("followUpShownAt")?.let(Instant::parse)
    val last = json.nullablePaywallString("lastShownAt")?.let(Instant::parse)
    val periodic = json.nullablePaywallString("periodicShownAt")?.let(Instant::parse)
    require((intro == null && date == null && zone == null) || (intro != null && date != null && zone != null)) {
        "Paywall state must include all three intro fields together."
    }
    require(intro == null || intro.atZone(ZoneId.of(requireNotNull(zone))).toLocalDate() == date) {
        "Paywall intro local date does not match its instant and timezone."
    }
    require((intro == null && followUp == null && periodic == null) || last != null) {
        "Paywall stage requires lastShownAt."
    }
    require(last == null || listOfNotNull(intro, followUp, periodic).all { it <= last }) {
        "Paywall lastShownAt precedes a review impression."
    }
    return CloudPaywallState(intro, date, zone, followUp, last, periodic)
}

fun parseCloudPaywallImpression(json: JSONObject): CloudPaywallImpression {
    val id = json.requiredPaywallString("presentationId")
    require(UUID.fromString(id).toString() == id) { "Invalid paywall presentation UUID." }
    val shownAt = Instant.parse(json.requiredPaywallString("shownAt"))
    val date = parsePaywallDate(json.requiredPaywallString("localDate"))
    val zone = json.requiredPaywallString("timeZone").also(::requirePaywallZone)
    require(shownAt.atZone(ZoneId.of(zone)).toLocalDate() == date) {
        "Paywall local date does not match its instant and timezone."
    }
    val trigger = json.nullablePaywallString("reviewTrigger")?.let { value ->
        requireNotNull(AnalyticsReviewPaywallTrigger.entries.find { it.wireValue == value }) {
            "Invalid review paywall trigger: $value."
        }
    }
    return CloudPaywallImpression(id, shownAt, date, zone, trigger)
}

fun CloudPaywallState.toJson(): JSONObject = JSONObject()
    .put("introShownAt", introShownAt?.toString() ?: JSONObject.NULL)
    .put("introLocalDate", introLocalDate?.toString() ?: JSONObject.NULL)
    .put("introTimeZone", introTimeZone ?: JSONObject.NULL)
    .put("followUpShownAt", followUpShownAt?.toString() ?: JSONObject.NULL)
    .put("lastShownAt", lastShownAt?.toString() ?: JSONObject.NULL)
    .put("periodicShownAt", periodicShownAt?.toString() ?: JSONObject.NULL)

fun mergeCloudPaywallState(first: CloudPaywallState, second: CloudPaywallState): CloudPaywallState {
    val intro = listOf(first, second).filter { it.introShownAt != null }.minByOrNull { it.introShownAt!! }
    return CloudPaywallState(
        intro?.introShownAt,
        intro?.introLocalDate,
        intro?.introTimeZone,
        listOfNotNull(first.followUpShownAt, second.followUpShownAt).minOrNull(),
        listOfNotNull(first.lastShownAt, second.lastShownAt).maxOrNull(),
        listOfNotNull(first.periodicShownAt, second.periodicShownAt).maxOrNull()
    )
}

fun applyCloudPaywallImpression(state: CloudPaywallState, impression: CloudPaywallImpression): CloudPaywallState {
    val isIntro = impression.reviewTrigger == AnalyticsReviewPaywallTrigger.INITIAL
    return mergeCloudPaywallState(state, CloudPaywallState(
        if (isIntro) impression.shownAt else null,
        if (isIntro) impression.localDate else null,
        if (isIntro) impression.timeZone else null,
        if (impression.reviewTrigger == AnalyticsReviewPaywallTrigger.DAY3) impression.shownAt else null,
        impression.shownAt,
        if (impression.reviewTrigger == AnalyticsReviewPaywallTrigger.WEEKLY) impression.shownAt else null
    ))
}

private fun JSONObject.nullablePaywallString(key: String): String? {
    require(has(key)) { "Paywall response is missing $key." }
    return if (isNull(key)) null else requiredPaywallString(key)
}

private fun JSONObject.requiredPaywallString(key: String): String {
    val value = get(key)
    require(value is String && value.isNotBlank()) { "Paywall $key must be a nonempty string." }
    return value
}

private fun parsePaywallDate(value: String): LocalDate {
    val date = LocalDate.parse(value)
    require(date.toString() == value && value.length == 10) { "Paywall date must use YYYY-MM-DD." }
    return date
}

private fun requirePaywallZone(value: String) {
    require(value in ZoneId.getAvailableZoneIds()) { "Paywall timezone must be an IANA zone." }
}
