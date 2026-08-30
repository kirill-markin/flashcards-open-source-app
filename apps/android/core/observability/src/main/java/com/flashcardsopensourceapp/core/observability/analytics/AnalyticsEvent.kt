package com.flashcardsopensourceapp.core.observability.analytics

/**
 * Hand-written mirror of the backend product-analytics catalog.
 *
 * The server keeps a closed allowlist of event names, property names and property values, so this
 * file is deliberately type-strict: there is no `track(name, properties)` anywhere. Every event is
 * its own data class whose constructor arguments are exactly the properties the server declares,
 * which means an event missing a property or inventing one does not compile.
 *
 * Every enum value below is now a value the catalog declares, so an event that compiles carries a
 * `screen` and property values the server accepts. `AnalyticsSurface` mirrors the catalog whole,
 * including values no Android screen reaches yet, because it is the contract rather than an
 * inventory of what happens to be wired today.
 *
 * A narrower enum is allowed, and every omission is deliberate and documented at the enum itself.
 * A value being absent here is therefore not on its own evidence that the server rejects it.
 *
 * Ten events are server-derived — `guest_upgrade_completed`, `review_answered`, `card_created`,
 * `card_updated`, `deck_created`, `deck_updated`, `friend_invitation_created`,
 * `friendship_created`, `ai_message_sent` and `catalog_deck_installed`. A client batch that
 * contains any of them is rejected, so they are absent here on purpose.
 *
 * `onboarding_step_completed`, `review_session_started` and `review_session_ended` were removed
 * from the catalog outright, so the server no longer declares them and rejects them as unknown
 * event names.
 *
 * Two client events the catalog declares are absent because this client does not observe them yet
 * rather than because it may not send them: `signin_code_requested` and `signin_succeeded`.
 * Whoever wires the Android sign-in funnel adds each one here and at its emit site together, and
 * reads the catalog entry for the shape.
 */

/** Named because the delivery path has to recognise a batch that carries nothing else. */
internal const val analyticsEventsDroppedEventName: String = "analytics_events_dropped"

/**
 * Shared cross-platform surface enum for the top-level `screen` field, in the catalog's own order.
 *
 * `screen` carries two readings. On `screen_viewed` and on every other event it is where the person
 * is now. On `signin_failed` alone it is the entry point that owned the sign-in control the person
 * tapped, never `SIGNIN` itself, which is why that value arrives on the sign-in route as an origin
 * argument rather than being read off the current destination.
 *
 * Values with no Android destination today — the catalog import steps, `SHARE` and
 * `FRIEND_INVITE_ACCEPT`, which are web landing pages, plus `CATALOG` — are mirrored anyway so the
 * list stays comparable to the server's line for line.
 *
 * `FRIEND_INVITE` is not one of them. It is the friend invitation dialog, which this app renders
 * from the settings screen and from the progress leaderboard, and both sites report it. Being a
 * dialog rather than a destination, it is reported from those two render sites instead of from the
 * route map.
 */
enum class AnalyticsSurface(val wireValue: String) {
    REVIEW(wireValue = "review"),
    CATALOG(wireValue = "catalog"),
    DECK_DETAIL(wireValue = "deck_detail"),
    CARD_EDITOR(wireValue = "card_editor"),
    CARDS(wireValue = "cards"),
    PROGRESS(wireValue = "progress"),
    SETTINGS(wireValue = "settings"),
    AI(wireValue = "ai"),

    // Workspace content management. These sit under the settings screen only as a routing accident:
    // they act on the person's own decks, cards and tags.
    DECKS(wireValue = "decks"),
    DECK_EDITOR(wireValue = "deck_editor"),
    TAGS(wireValue = "tags"),

    // Authentication. `SIGNIN` is the sign-in screen itself, whatever the client splits it into:
    // the email step, the code step and the workspace choice are one screen here.
    // `CREDENTIAL_RECOVERY` is the gate that replaces this app's root when stored credentials can
    // no longer be used.
    SIGNIN(wireValue = "signin"),
    CREDENTIAL_RECOVERY(wireValue = "credential_recovery"),

    // Our own in-app prompts, each a screen a person has to answer before anything else continues.
    // `AnalyticsPrompt` names its surface rather than repeating the spelling, because
    // `prompt_answered.prompt` has to equal the surface for an answer to join to its showing.
    NOTIFICATIONS_PRE_PROMPT(wireValue = "notifications_pre_prompt"),
    SIGNIN_AFTER_REVIEW_PROMPT(wireValue = "signin_after_review_prompt"),

    CATALOG_IMPORT_SIGNIN(wireValue = "catalog_import_signin"),
    CATALOG_IMPORT_WORKSPACE(wireValue = "catalog_import_workspace"),
    CATALOG_IMPORT_CONFIRM(wireValue = "catalog_import_confirm"),
    CATALOG_IMPORT_DONE(wireValue = "catalog_import_done"),

    FRIEND_INVITE(wireValue = "friend_invite"),
    FRIEND_INVITE_ACCEPT(wireValue = "friend_invite_accept"),

    SHARE(wireValue = "share")
}

/** Captured when the event is created, never when the batch is flushed. */
enum class AnalyticsNetworkState(val wireValue: String) {
    WIFI(wireValue = "wifi"),
    CELLULAR(wireValue = "cellular"),
    OFFLINE(wireValue = "offline"),
    UNKNOWN(wireValue = "unknown")
}

/**
 * Deliberately two values where the catalog declares three. The catalog's `unknown` is server-only
 * in practice: it exists for days reconstructed from stored activity long after the fact, which
 * cannot know how the app was entered. A live client always knows whether it cold- or warm-started,
 * and ingest *accepts* `unknown` from a client, so this union is the only thing stopping one from
 * being written. Do not widen it to mirror the catalog.
 */
enum class AnalyticsLaunchType(val wireValue: String) {
    COLD(wireValue = "cold"),
    WARM(wireValue = "warm")
}

/**
 * Our own in-app prompts. Each names the surface it is shown on rather than carrying a second
 * spelling of it, because `prompt_answered.prompt` and the prompt's surface must stay identical for
 * an answer to join to the `screen_viewed` that recorded the showing.
 */
enum class AnalyticsPrompt(val surface: AnalyticsSurface) {
    SIGNIN_AFTER_REVIEW_PROMPT(surface = AnalyticsSurface.SIGNIN_AFTER_REVIEW_PROMPT),
    NOTIFICATIONS_PRE_PROMPT(surface = AnalyticsSurface.NOTIFICATIONS_PRE_PROMPT);

    val wireValue: String
        get() = surface.wireValue
}

/**
 * `SNOOZED` is an answer that asks to be asked again later, as opposed to `DISMISSED`, which closes
 * the prompt for good. Which of the two a given prompt can produce is a product decision, not a
 * catalog one.
 */
enum class AnalyticsPromptOutcome(val wireValue: String) {
    ACCEPTED(wireValue = "accepted"),
    DISMISSED(wireValue = "dismissed"),
    SNOOZED(wireValue = "snoozed")
}

/**
 * OS permissions. [NOTIFICATIONS], [CAMERA] and [MICROPHONE] each have an Android request path and
 * every one of them is reported: notifications from the review flow and from the settings
 * notifications screen, camera and microphone from the AI screen's camera and dictation controls and
 * from the per-capability access screen under settings.
 *
 * [PHOTO_LIBRARY] is mirrored without a request path, and not because a call site was missed: this
 * app reads photos through the system photo picker, which grants access to what the person picked
 * and asks for no runtime permission, so there is no OS dialog here whose answer could be observed.
 * The clients whose platform does ask are the ones that report it.
 */
enum class AnalyticsPermission(val wireValue: String) {
    NOTIFICATIONS(wireValue = "notifications"),
    PHOTO_LIBRARY(wireValue = "photo_library"),
    CAMERA(wireValue = "camera"),
    MICROPHONE(wireValue = "microphone")
}

/**
 * How the OS answered a permission dialog.
 *
 * Android's `RequestPermission` contract reports one boolean, so this client can only report
 * [GRANTED] and [DENIED]. [DISMISSED] is mirrored for the clients whose OS distinguishes "closed
 * without answering" from a refusal; reporting it here would mean inventing a distinction the
 * platform did not make.
 */
enum class AnalyticsPermissionOutcome(val wireValue: String) {
    GRANTED(wireValue = "granted"),
    DENIED(wireValue = "denied"),
    DISMISSED(wireValue = "dismissed")
}

/**
 * [CODE_ALREADY_USED] is reported only by app versions whose mapping separates the auth service's
 * `OTP_CHALLENGE_CONSUMED` from an expired session. One that folds them reports [EXPIRED_CODE] for
 * both, so an `expired_code` series is not like-for-like across that boundary.
 */
enum class AnalyticsSignInFailureReason(val wireValue: String) {
    INVALID_CODE(wireValue = "invalid_code"),
    EXPIRED_CODE(wireValue = "expired_code"),
    CODE_ALREADY_USED(wireValue = "code_already_used"),
    RATE_LIMITED(wireValue = "rate_limited"),
    OFFLINE(wireValue = "offline"),
    SERVER_ERROR(wireValue = "server_error"),
    CANCELLED(wireValue = "cancelled")
}

enum class AnalyticsReviewAnswerFailureReason(val wireValue: String) {
    OFFLINE(wireValue = "offline"),
    TIMEOUT(wireValue = "timeout"),
    SYNC_CONFLICT(wireValue = "sync_conflict"),
    SERVER_ERROR(wireValue = "server_error")
}

enum class AnalyticsCardCreateEntryPoint(val wireValue: String) {
    CARDS(wireValue = "cards"),
    DECK_DETAIL(wireValue = "deck_detail"),
    REVIEW(wireValue = "review"),
    AI(wireValue = "ai"),
    QUICK_ACTION(wireValue = "quick_action")
}

enum class AnalyticsSyncFailureReason(val wireValue: String) {
    OFFLINE(wireValue = "offline"),
    TIMEOUT(wireValue = "timeout"),
    CONFLICT(wireValue = "conflict"),
    UNAUTHORIZED(wireValue = "unauthorized"),
    SERVER_ERROR(wireValue = "server_error"),
    STORAGE_FULL(wireValue = "storage_full")
}

enum class AnalyticsDroppedReason(val wireValue: String) {
    QUEUE_OVERFLOW(wireValue = "queue_overflow"),
    TTL_EXPIRED(wireValue = "ttl_expired"),
    REJECTED(wireValue = "rejected")
}

/**
 * The two property value kinds the server catalog accepts from this client: an exact allowlisted
 * string, and an integer greater than or equal to zero.
 */
sealed interface AnalyticsPropertyValue {
    data class Text(val value: String) : AnalyticsPropertyValue

    data class Count(val value: Int) : AnalyticsPropertyValue
}

sealed interface AnalyticsEvent {
    val eventName: String

    /** Top-level event field, never a property. Legal on every event, required on `screen_viewed`. */
    val screen: AnalyticsSurface?

    val properties: Map<String, AnalyticsPropertyValue>

    data class AppOpened(
        val launchType: AnalyticsLaunchType,
        override val screen: AnalyticsSurface? = null
    ) : AnalyticsEvent {
        override val eventName: String = "app_opened"
        override val properties: Map<String, AnalyticsPropertyValue> = mapOf(
            "launch_type" to AnalyticsPropertyValue.Text(value = launchType.wireValue)
        )
    }

    /** `screen` is non-null here on purpose: the server rejects `screen_viewed` without it. */
    data class ScreenViewed(
        override val screen: AnalyticsSurface
    ) : AnalyticsEvent {
        override val eventName: String = "screen_viewed"
        override val properties: Map<String, AnalyticsPropertyValue> = emptyMap()
    }

    data class SignInFailed(
        val reason: AnalyticsSignInFailureReason,
        override val screen: AnalyticsSurface? = null
    ) : AnalyticsEvent {
        override val eventName: String = "signin_failed"
        override val properties: Map<String, AnalyticsPropertyValue> = mapOf(
            "reason" to AnalyticsPropertyValue.Text(value = reason.wireValue)
        )
    }

    /**
     * One of our own in-app prompts was answered. The showing of that prompt is a separate
     * `screen_viewed` on the same surface, and the conversion between the two is a query; this
     * event alone cannot express a rate.
     *
     * `screen` is derived rather than passed: the person answering a prompt is on that prompt, and
     * letting a call site name a different surface would only produce answers that join to nothing.
     */
    data class PromptAnswered(
        val prompt: AnalyticsPrompt,
        val outcome: AnalyticsPromptOutcome
    ) : AnalyticsEvent {
        override val eventName: String = "prompt_answered"
        override val screen: AnalyticsSurface = prompt.surface
        override val properties: Map<String, AnalyticsPropertyValue> = mapOf(
            "prompt" to AnalyticsPropertyValue.Text(value = prompt.wireValue),
            "outcome" to AnalyticsPropertyValue.Text(value = outcome.wireValue)
        )
    }

    /**
     * The OS permission dialog, whose outcome the app only observes. A different fact from
     * [PromptAnswered]: a person can accept our pre-prompt and still deny the system one, and the
     * gap between the two is the whole reason both exist.
     *
     * `screen` is required here even though the server allows it to be absent. The same permission
     * is reachable from more than one place, and the surface is the only thing that tells those
     * places apart, so a default would quietly attribute every request to whichever one was
     * hardcoded. It reads as where the person is when the answer arrives, not as the surface that
     * asked, because an OS dialog can be answered after the app was backgrounded.
     */
    data class PermissionPromptAnswered(
        val permission: AnalyticsPermission,
        val outcome: AnalyticsPermissionOutcome,
        override val screen: AnalyticsSurface
    ) : AnalyticsEvent {
        override val eventName: String = "permission_prompt_answered"
        override val properties: Map<String, AnalyticsPropertyValue> = mapOf(
            "permission" to AnalyticsPropertyValue.Text(value = permission.wireValue),
            "outcome" to AnalyticsPropertyValue.Text(value = outcome.wireValue)
        )
    }

    /**
     * The card flip, once per card presentation. It never reaches the backend on its own, so only a
     * client can report it, and it is the denominator the server-derived `review_answered` is read
     * against: the gap between the two is the person who looked at the answer and walked away.
     *
     * `screen` is fixed rather than defaulted. The server rejects `review_card_revealed` without it,
     * and the flip exists only on the review screen, so there is nothing for a call site to choose:
     * a defaulted parameter would only let a future one inherit `review` from somewhere the person
     * is not, which is the same hazard [PermissionPromptAnswered] refuses a default for.
     */
    data object ReviewCardRevealed : AnalyticsEvent {
        override val eventName: String = "review_card_revealed"
        override val screen: AnalyticsSurface = AnalyticsSurface.REVIEW
        override val properties: Map<String, AnalyticsPropertyValue> = emptyMap()
    }

    data class ReviewAnswerFailed(
        val reason: AnalyticsReviewAnswerFailureReason,
        override val screen: AnalyticsSurface? = AnalyticsSurface.REVIEW
    ) : AnalyticsEvent {
        override val eventName: String = "review_answer_failed"
        override val properties: Map<String, AnalyticsPropertyValue> = mapOf(
            "reason" to AnalyticsPropertyValue.Text(value = reason.wireValue)
        )
    }

    data class CardCreateStarted(
        val entryPoint: AnalyticsCardCreateEntryPoint,
        override val screen: AnalyticsSurface? = null
    ) : AnalyticsEvent {
        override val eventName: String = "card_create_started"
        override val properties: Map<String, AnalyticsPropertyValue> = mapOf(
            "entry_point" to AnalyticsPropertyValue.Text(value = entryPoint.wireValue)
        )
    }

    data class SyncFailed(
        val reason: AnalyticsSyncFailureReason,
        override val screen: AnalyticsSurface? = null
    ) : AnalyticsEvent {
        override val eventName: String = "sync_failed"
        override val properties: Map<String, AnalyticsPropertyValue> = mapOf(
            "reason" to AnalyticsPropertyValue.Text(value = reason.wireValue)
        )
    }

    data class CatalogDeckInstallStarted(
        val packageSlug: String,
        override val screen: AnalyticsSurface? = AnalyticsSurface.CATALOG
    ) : AnalyticsEvent {
        override val eventName: String = "catalog_deck_install_started"
        override val properties: Map<String, AnalyticsPropertyValue> = mapOf(
            "package_slug" to AnalyticsPropertyValue.Text(value = packageSlug)
        )
    }

    data class AnalyticsEventsDropped(
        val reason: AnalyticsDroppedReason,
        val count: Int,
        override val screen: AnalyticsSurface? = null
    ) : AnalyticsEvent {
        override val eventName: String = analyticsEventsDroppedEventName
        override val properties: Map<String, AnalyticsPropertyValue> = mapOf(
            "reason" to AnalyticsPropertyValue.Text(value = reason.wireValue),
            "count" to AnalyticsPropertyValue.Count(value = nonNegativeAnalyticsCount(value = count.toLong()))
        )
    }
}

/**
 * The server rejects negatives and anything outside the integer range, and a rejected event is
 * reported back only as the generic `invalid_event`. Clamping here keeps a bad caller-side count
 * from silently costing the event.
 */
private fun nonNegativeAnalyticsCount(value: Long): Int {
    return value.coerceIn(0L, Int.MAX_VALUE.toLong()).toInt()
}
