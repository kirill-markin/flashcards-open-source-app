package com.flashcardsopensourceapp.core.observability.analytics

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit

/**
 * Storage name for the analytics identity. It is excluded from Android auto-backup and from
 * device-to-device transfer in `apps/android/app/src/main/res/xml/data_extraction_rules.xml`, the
 * document the application element points at with `android:dataExtractionRules`.
 *
 * That exclusion is load-bearing, not hygiene: a restored `anonymous_id` would appear on a second
 * device, and identity resolution in `analytics.identity_links` is first-link-wins with no repair
 * path, so a shared id merges two people permanently.
 */
const val analyticsIdentityPreferencesName: String = "flashcards-analytics-identity"

private const val anonymousIdKey: String = "anonymous_id"
private const val sessionIdKey: String = "session_id"
private const val lastEventAtMillisKey: String = "last_event_at_millis"

/**
 * `anonymous_id` and `session_id` lifecycle.
 *
 * The sync installation id is deliberately not reused: it must stay stable across users, while
 * `anonymous_id` must reset on logout so a second person on a shared device does not inherit the
 * first person's identity.
 */
class AnalyticsIdentity(
    context: Context
) {
    private val preferences: SharedPreferences = context.applicationContext.getSharedPreferences(
        analyticsIdentityPreferencesName,
        Context.MODE_PRIVATE
    )

    /** One lowercase UUID per install, rotated only on explicit logout. */
    @Synchronized
    fun currentAnonymousId(): String {
        val storedAnonymousId: String? = preferences.getString(anonymousIdKey, null)
        if (!storedAnonymousId.isNullOrBlank()) {
            return storedAnonymousId
        }

        val createdAnonymousId: String = newAnalyticsUuid()
        preferences.edit(commit = true) {
            putString(anonymousIdKey, createdAnonymousId)
        }
        return createdAnonymousId
    }

    /**
     * A UUID that rotates after 30 minutes with no emitted analytics event, foreground or
     * background alike. Inactivity rather than backgrounding is deliberate and identical on the
     * web and iOS clients; rotating on backgrounding here would make session counts incomparable
     * while looking like the same constant.
     *
     * The expiry test is **signed**, never an absolute difference, and there is deliberately no
     * `nowMillis < lastEventAtMillis` branch. A session is a statement about user activity, not
     * about the device clock, so neither of the two ways `nowMillis` can land below the stored
     * timestamp may mint a new one:
     *
     *  - a clock correction backwards, after which an absolute test would rotate on *every* event
     *    until wall time catches up, producing one session per event for the size of the jump;
     *  - an event that reaches this method after a later one, which needs no clock movement at all.
     *    [AnalyticsClient.track] stamps `occurredAtMillis` on the caller's thread and hands the
     *    event off through a channel whose ordering only holds per sender thread, and events are
     *    tracked from the main thread and from a WorkManager thread alike; the flush-time
     *    `analytics_events_dropped` rows are stamped later still.
     *
     * For the same reason the stored timestamp is clamped forward: a reordered arrival must not
     * rewind `last_event_at` for everything that follows it.
     */
    @Synchronized
    fun sessionIdForEvent(nowMillis: Long): String {
        val storedSessionId: String? = preferences.getString(sessionIdKey, null)
        val lastEventAtMillis: Long = preferences.getLong(lastEventAtMillisKey, 0L)
        val isExpired: Boolean = storedSessionId.isNullOrBlank() ||
            lastEventAtMillis <= 0L ||
            nowMillis - lastEventAtMillis >= analyticsSessionTimeoutMillis

        val sessionId: String = if (isExpired) newAnalyticsUuid() else storedSessionId.orEmpty()
        // Asynchronous on purpose: this runs once per emitted event, and the only cost of losing
        // the last write to a crash is one extra session rotation.
        preferences.edit(commit = false) {
            putString(sessionIdKey, sessionId)
            putLong(lastEventAtMillisKey, maxOf(lastEventAtMillis, nowMillis))
        }
        return sessionId
    }

    /** Explicit logout: a new person on this install must not inherit the previous identity. */
    @Synchronized
    fun rotateForLogout() {
        preferences.edit(commit = true) {
            putString(anonymousIdKey, newAnalyticsUuid())
            remove(sessionIdKey)
            remove(lastEventAtMillisKey)
        }
    }
}
