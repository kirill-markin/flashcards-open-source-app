import Foundation

/**
 * Hand-written mirror of the backend product analytics catalog in
 * `apps/backend/src/productAnalytics/catalog.ts`. The server rejects anything it does not declare,
 * so the client API is type-strict per event: every case carries exactly the properties the catalog
 * declares and there is deliberately no `track(name:properties:)` anywhere. A typo or an undeclared
 * property does not compile instead of becoming a silent server-side rejection.
 *
 * Every enum value below is a value the current catalog declares, so a value here is again proof
 * the server accepts it. The one that was not — `AnalyticsSurface.onboarding`, dropped by the
 * catalog — is gone; while it existed an event carrying it as its `screen` compiled and was
 * rejected `invalid_event`.
 *
 * The eleven server-derived events are absent here on purpose, because a client batch that carries
 * one is rejected `server_only_event`: `guest_upgrade_completed`, `review_answered`, `card_created`,
 * `card_updated`, `deck_created`, `deck_updated`, `friend_invitation_created`, `friendship_created`,
 * `ai_message_sent`, `ai_run_failed` and `catalog_deck_installed`.
 *
 * `onboarding_step_completed`, `review_session_started` and `review_session_ended` remain outside
 * the active catalog. The server keeps exact backend-only tombstones for old queued copies and
 * rejects them `retired_event_name`.
 */
enum AnalyticsEvent: Sendable, Equatable {
    case appOpened(launchType: AnalyticsLaunchType)
    case screenViewed(screen: AnalyticsSurface)
    /**
     * The two middle steps of the sign-in funnel, read against `signInFailed`.
     *
     * Each carries the surface its sign-in is running on, which the catalog requires and which is
     * `screen` in its ordinary reading — where the person is now. That is deliberately not
     * `signInFailed`'s entry point: the ordinary flow is `signin` wherever the sheet was opened
     * from, and only the credential-recovery gate, which replaces the app root instead of
     * presenting over a screen, reports itself.
     */
    case signInCodeRequested(screen: AnalyticsSurface)
    case signInSucceeded(screen: AnalyticsSurface)
    case signInFailed(reason: AnalyticsSignInFailureReason)
    /// The card flip: the answer side being shown, once per card presentation. It never reaches the
    /// backend on its own, so only a client can report it, and it is the denominator the
    /// server-derived `review_answered` is read against.
    case reviewCardRevealed
    case reviewAnswerFailed(reason: AnalyticsReviewAnswerFailureReason)
    /**
     * One of our own in-app prompts was answered.
     *
     * This is not the same fact as `permissionPromptAnswered` and the two must never be merged: this
     * one is ours to decide when to show, while that one is an OS dialog whose outcome the app only
     * observes, and a person can accept ours and still deny the system's. The prompt being *shown*
     * is a third fact, recorded as `screen_viewed` on the prompt's own surface, so the conversion
     * between showing and answering is a query rather than something a client has to compute.
     */
    case promptAnswered(prompt: AnalyticsPrompt, outcome: AnalyticsPromptOutcome)
    /**
     * An OS permission dialog was answered.
     *
     * The surface is carried by the event's own `screen` and never duplicated into a property: an OS
     * dialog can be answered after the app was backgrounded and resumed somewhere else, so the
     * surface that asked for the permission is not necessarily where the person is when the answer
     * arrives, and only the latter is what `screen` means here.
     */
    case permissionPromptAnswered(permission: AnalyticsPermission, outcome: AnalyticsPermissionOutcome)
    /**
     * An image reached the chat draft or the card being edited.
     *
     * The attachment itself, read against the `photoLibrary` and `camera` answers
     * `permissionPromptAnswered` already records: granting the permission and opening the picker is
     * not the same fact as ending up with an image on a card. It is emitted where the asset is
     * appended, never where a picker is presented, because a picker a person backs out of attached
     * nothing.
     *
     * The surface travels with the event because the catalog requires one and this app attaches from
     * two screens, so leaving it to a `track(screen:)` a call site can forget would produce an event
     * the server rejects `missing_screen`.
     */
    case mediaAttached(source: AnalyticsMediaSource, screen: AnalyticsSurface)
    /// The failure half of `mediaAttached`, emitted only on the paths that also report the success,
    /// so the two stay countable against each other. Build the reason with
    /// `analyticsMediaUploadFailureReason(error:)` rather than choosing one at a call site.
    case mediaUploadFailed(reason: AnalyticsMediaUploadFailureReason)
    /**
     * One reminder the OS accepted, reported once per distinct scheduled notification.
     *
     * Reconciliation runs on many triggers and re-schedules the same slots every time, so an emit
     * site must report only the slots it has not reported before; a slot id is built from the
     * reminder kind and the wall clock it fires at — except inactivity reminders, whose id is the
     * local day and position — never from the scheduling request identifier, which is what makes
     * that comparison a comparison of scheduled notifications rather than of reconciliation runs.
     * The slot identity is defined in `ScheduledNotificationFactReporting`.
     */
    case notificationScheduled(notificationKind: AnalyticsNotificationKind)
    /// A reminder tap that brought the person back, reported where the OS hands the response to the
    /// app. It is the numerator `notificationScheduled` is the denominator of.
    case notificationOpened(notificationKind: AnalyticsNotificationKind)
    case cardCreateStarted(entryPoint: AnalyticsCardCreateEntryPoint)
    /**
     * Voice input reached the microphone: the recorder really started, not the button being pressed.
     *
     * A permission the person refuses therefore produces `dictationFailed` and no start at all, which
     * is what keeps the pair readable — every start is an attempt that could have produced a
     * transcript. Nothing about the recording is reported here or on the failure: a transcript is
     * content a person spoke.
     */
    case dictationStarted
    /// The catalog allows this one to carry no surface, but every call site passes `screen: .ai`:
    /// dictation exists nowhere else on this client, so the failure names the same surface its start
    /// declares. Web takes the caller's route instead, because its composer opens over one.
    case dictationFailed(reason: AnalyticsDictationFailureReason)
    /// Emit only through `Analytics.reportSyncFailure(reason:)`. Sync is retried on a timer, so a
    /// direct `track` measures poll cadence instead of failure incidence.
    case syncFailed(reason: AnalyticsSyncFailureReason)
    case catalogDeckInstallStarted(packageSlug: String)
    case analyticsEventsDropped(reason: AnalyticsDroppedReason, count: Int)
}

/**
 * Platform-independent surfaces from the backend catalog. Native screens are mapped onto these and a
 * native screen name is never sent, because cross-client funnel comparison is the only reason the
 * surface list is shared at all.
 *
 * Existing spellings are never renamed: they are already in production data and a rename silently
 * splits a series in two. The catalog surfaces missing here name screens this app does not have —
 * the public catalog import steps, the friend-invitation landing page and the platform-links share
 * page are web routes — so this client sends no `screen` where it has no screen, rather than the
 * nearest wrong one.
 */
enum AnalyticsSurface: String, Sendable, Equatable, CaseIterable {
    case review
    case catalog
    case deckDetail = "deck_detail"
    case cardEditor = "card_editor"
    case cards
    case progress
    case settings
    // The legal and privacy screen, the one settings leaf the catalog names on its own, because the
    // analytics opt-out promised in the privacy policy is exercised there. Nothing here reports it:
    // `AccountLegalView` is still counted as `settings` like every other leaf.
    case settingsLegal = "settings_legal"
    case ai
    // Workspace content management. These are pushed under Settings here only as a routing accident:
    // they act on the person's own decks, cards and tags, the same object family `cards`,
    // `cardEditor` and `deckDetail` already name.
    case decks
    case deckEditor = "deck_editor"
    case tags
    // Authentication. `signin` is the whole sign-in sheet whatever it splits into — the email step,
    // the code step and the workspace choice are one screen in the catalog. `credentialRecovery` is
    // the gate that replaces the app root when stored credentials can no longer be used.
    case signin
    case credentialRecovery = "credential_recovery"
    // Our own in-app prompts, each a screen a person has to answer before anything else continues.
    // `AnalyticsPrompt` repeats these two spellings verbatim, so an answer joins to the
    // `screen_viewed` that recorded its showing by equality; the two must stay identical.
    case notificationsPrePrompt = "notifications_pre_prompt"
    case signInAfterReviewPrompt = "signin_after_review_prompt"
    // The friend-invitation creation screen. Its counterpart, the landing page the invited person
    // opens, is a web route with no iOS screen.
    case friendInvite = "friend_invite"
}

/**
 * Captured when the event is created rather than when the batch flushes. A queued batch can only
 * ever be sent while online, so a flush-time reading could never record `offline`, which is the one
 * value the column exists for.
 */
enum AnalyticsNetworkState: String, Sendable, Equatable {
    case wifi
    case cellular
    case offline
    case unknown
}

/**
 * Deliberately only the two values a client can know.
 *
 * The catalog declares a third, `unknown`, and it is server-only in practice rather than in the
 * schema: it exists for the days migration `0121` reconstructed from stored activity long after the
 * fact, which cannot know whether a launch was cold or warm, while a live client always can. Ingest
 * accepts `unknown` from a client, so this union is the only thing preventing one from being sent.
 * Do not widen it when mirroring the catalog.
 */
enum AnalyticsLaunchType: String, Sendable, Equatable {
    case cold
    case warm
}

/**
 * The in-app prompts, spelled exactly as their own surfaces in `AnalyticsSurface` so an answer joins
 * to the `screen_viewed` that recorded its showing without a mapping.
 */
enum AnalyticsPrompt: String, Sendable, Equatable {
    case signInAfterReviewPrompt = "signin_after_review_prompt"
    case notificationsPrePrompt = "notifications_pre_prompt"
}

/**
 * How one of our own prompts was answered.
 *
 * Both iOS prompts are UIKit-backed alerts, which cannot be closed without pressing a button, so
 * every answer here comes from a button and each prompt produces only the outcomes its buttons mean:
 * the after-review sign-in prompt reports `accepted` or `snoozed` — its "Later" really does snooze
 * for a week — and the notifications pre-prompt reports `accepted` or `dismissed`. A programmatic
 * teardown, such as a cloud identity reset closing a prompt nobody answered, reports nothing.
 */
enum AnalyticsPromptOutcome: String, Sendable, Equatable {
    case accepted
    case dismissed
    case snoozed
}

enum AnalyticsPermission: String, Sendable, Equatable {
    case notifications
    case photoLibrary = "photo_library"
    case camera
    case microphone
}

/**
 * How the OS permission dialog was answered. `dismissed` is the answer that is not one: the person
 * closed the dialog leaving the permission undetermined.
 *
 * Only the photo-library request can report it, because only `PHPhotoLibrary` answers with a status
 * that can still be `notDetermined`. The camera, microphone and notification requests answer with a
 * bool, so an undecided close is indistinguishable from a denial there and is reported as `denied`.
 * A zero `dismissed` count for those three is structural rather than a signal.
 */
enum AnalyticsPermissionOutcome: String, Sendable, Equatable {
    case granted
    case denied
    case dismissed
}

/**
 * Where an attached asset came from, spelled exactly as the matching `AnalyticsPermission` values so
 * an attachment joins to its own permission answer by equality.
 *
 * The file importer has no value here and reports nothing: a document picked out of Files is neither
 * of these two, and the catalog would rather count fewer attachments than store a wrong origin in an
 * append-only table.
 */
enum AnalyticsMediaSource: String, Sendable, Equatable {
    case photoLibrary = "photo_library"
    case camera
}

/**
 * Why an attachment did not happen. Deliberately narrower than the catalog, which also declares
 * `offline`, `timeout` and `cancelled` for the upload path that will produce them: attaching is
 * entirely local here — the asset is written to the draft or to the card and uploaded later by the
 * media upload path, which reports nothing — so nothing on these paths can observe a transport
 * failure, and the one cancellation this app raises is an import superseded by the next one rather
 * than a person walking away. Leaving the three out is what stops one being constructed with no
 * mapping behind it. The web and Android mirrors are narrowed to the same three.
 */
enum AnalyticsMediaUploadFailureReason: String, Sendable, Equatable {
    case tooLarge = "too_large"
    case unsupportedType = "unsupported_type"
    case serverError = "server_error"
}

/**
 * `codeAlreadyUsed` is reported only by app versions whose mapping separates the auth service's
 * `OTP_CHALLENGE_CONSUMED` from an expired session. One that folds them reports `expiredCode` for
 * both, so an `expired_code` series is not like-for-like across that boundary.
 */
enum AnalyticsSignInFailureReason: String, Sendable, Equatable {
    case invalidCode = "invalid_code"
    case expiredCode = "expired_code"
    case codeAlreadyUsed = "code_already_used"
    case rateLimited = "rate_limited"
    case offline
    case serverError = "server_error"
    case cancelled
}

enum AnalyticsReviewAnswerFailureReason: String, Sendable, Equatable {
    case offline
    case timeout
    case syncConflict = "sync_conflict"
    case serverError = "server_error"
}

/// The two reminders this app schedules with `UNUserNotificationCenter`.
enum AnalyticsNotificationKind: String, Sendable, Equatable {
    case reviewReminder = "review_reminder"
    case strictReminder = "strict_reminder"
}

enum AnalyticsCardCreateEntryPoint: String, Sendable, Equatable {
    case cards
    case deckDetail = "deck_detail"
    case review
    case ai
    case quickAction = "quick_action"
}

/**
 * Why one dictation attempt ended without a transcript.
 *
 * `permissionDenied` is the microphone refusal, both the answer to the OS dialog and the refusal it
 * already holds; `noSpeech` an empty recording; `cancelled` the attempt being abandoned, which on
 * this client is a recording cancelled before it was stopped or a cancelled dictation task; and
 * `serverError` the remaining bucket, which carries the reading it has on
 * `AnalyticsSyncFailureReason` — the attempt could not complete for a reason the person cannot act
 * on, a recorder that refused to start included.
 *
 * `offline` and `timeout` come from the transport failures that reach the dictation paths with their
 * `URLError` intact. The transcription client collapses its own transport failures into
 * `AIChatTranscriptionError.serviceUnavailable`, so those land in `serverError`; the event's own
 * `network_state` field is what still says whether the device had a connection.
 */
enum AnalyticsDictationFailureReason: String, Sendable, Equatable {
    case permissionDenied = "permission_denied"
    case offline
    case timeout
    case serverError = "server_error"
    case cancelled
    case noSpeech = "no_speech"
}

enum AnalyticsSyncFailureReason: String, Sendable, Equatable {
    case offline
    case timeout
    case conflict
    case unauthorized
    case serverError = "server_error"
    case storageFull = "storage_full"
}

/**
 * The catalog name of the loss-reporting event, needed by the delivery path: a refused
 * `analytics_events_dropped` must never be counted into a replacement, or the replacement is refused
 * for the same reason and the client posts forever without the queue ever changing.
 */
let analyticsEventsDroppedEventName: String = "analytics_events_dropped"

enum AnalyticsDroppedReason: String, Sendable, Equatable {
    case queueOverflow = "queue_overflow"
    case ttlExpired = "ttl_expired"
    case rejected
}

/// The only two property value kinds the catalog admits. Nested objects and arrays are rejected.
enum AnalyticsPropertyValue: Sendable, Equatable, Codable {
    case string(String)
    case integer(Int)

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let integer = try? container.decode(Int.self) {
            self = .integer(integer)
            return
        }

        self = .string(try container.decode(String.self))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .integer(let value):
            try container.encode(value)
        }
    }
}

extension AnalyticsEvent {
    var eventName: String {
        switch self {
        case .appOpened:
            return "app_opened"
        case .screenViewed:
            return "screen_viewed"
        case .signInCodeRequested:
            return "signin_code_requested"
        case .signInSucceeded:
            return "signin_succeeded"
        case .signInFailed:
            return "signin_failed"
        case .reviewCardRevealed:
            return "review_card_revealed"
        case .reviewAnswerFailed:
            return "review_answer_failed"
        case .promptAnswered:
            return "prompt_answered"
        case .permissionPromptAnswered:
            return "permission_prompt_answered"
        case .mediaAttached:
            return "media_attached"
        case .mediaUploadFailed:
            return "media_upload_failed"
        case .notificationScheduled:
            return "notification_scheduled"
        case .notificationOpened:
            return "notification_opened"
        case .cardCreateStarted:
            return "card_create_started"
        case .dictationStarted:
            return "dictation_started"
        case .dictationFailed:
            return "dictation_failed"
        case .syncFailed:
            return "sync_failed"
        case .catalogDeckInstallStarted:
            return "catalog_deck_install_started"
        case .analyticsEventsDropped:
            return analyticsEventsDroppedEventName
        }
    }

    /**
     * `screen` is a top-level event field on the wire, never a property: a surface placed inside
     * `properties` is rejected `unknown_property`. Only `screen_viewed`, `review_card_revealed`,
     * the two sign-in steps and `dictation_started` carry one of their own; every other event
     * takes the surface the caller was on, if any.
     */
    var declaredScreen: AnalyticsSurface? {
        switch self {
        case .screenViewed(let screen):
            return screen
        // The catalog requires a surface on the flip, and the flip has no home other than the review
        // screen. Declaring it here rather than leaving it to the call site is what keeps a caller
        // that forgets `screen:` from producing an event the server rejects `missing_screen`, which
        // is the reason a required screen that is absent draws; `invalid_event` is what an
        // unrecognised surface value draws instead.
        case .reviewCardRevealed:
            return .review
        // The catalog requires a surface on both sign-in steps, and the sign-in flow always knows
        // which of its two surfaces it is running on, so the value travels with the event instead
        // of being left to a `track(screen:)` a call site can forget.
        case .signInCodeRequested(let screen), .signInSucceeded(let screen):
            return screen
        // The catalog requires a surface on the attachment, and this app attaches from the chat and
        // from the card editor, so the screen is carried by the event rather than left to the call
        // site: a caller that forgot it would produce an event the server rejects `missing_screen`.
        case .mediaAttached(_, let screen):
            return screen
        // The catalog requires a surface on the start, and dictation has no home on this client
        // other than the AI chat composer, so there is nothing for a call site to choose.
        case .dictationStarted:
            return .ai
        default:
            return nil
        }
    }

    /**
     * Every declared property is required — the server builds a strict object with no optional
     * members — so each case fills in all of its own. Counters are clamped at zero because the
     * catalog admits no negative value and the table they land in is append-only.
     */
    var properties: [String: AnalyticsPropertyValue] {
        switch self {
        case .appOpened(let launchType):
            return ["launch_type": .string(launchType.rawValue)]
        case .screenViewed:
            return [:]
        case .signInCodeRequested, .signInSucceeded:
            return [:]
        case .signInFailed(let reason):
            return ["reason": .string(reason.rawValue)]
        case .reviewCardRevealed:
            return [:]
        case .reviewAnswerFailed(let reason):
            return ["reason": .string(reason.rawValue)]
        case .promptAnswered(let prompt, let outcome):
            return [
                "prompt": .string(prompt.rawValue),
                "outcome": .string(outcome.rawValue)
            ]
        case .permissionPromptAnswered(let permission, let outcome):
            return [
                "permission": .string(permission.rawValue),
                "outcome": .string(outcome.rawValue)
            ]
        case .mediaAttached(let source, _):
            return ["source": .string(source.rawValue)]
        case .mediaUploadFailed(let reason):
            return ["reason": .string(reason.rawValue)]
        case .notificationScheduled(let notificationKind), .notificationOpened(let notificationKind):
            return ["notification_kind": .string(notificationKind.rawValue)]
        case .cardCreateStarted(let entryPoint):
            return ["entry_point": .string(entryPoint.rawValue)]
        case .dictationStarted:
            return [:]
        case .dictationFailed(let reason):
            return ["reason": .string(reason.rawValue)]
        case .syncFailed(let reason):
            return ["reason": .string(reason.rawValue)]
        case .catalogDeckInstallStarted(let packageSlug):
            return ["package_slug": .string(packageSlug)]
        case .analyticsEventsDropped(let reason, let count):
            return [
                "reason": .string(reason.rawValue),
                "count": .integer(max(0, count))
            ]
        }
    }

    /**
     * The one property the type system cannot pin down. A catalog package slug arrives from the
     * backend already in slug shape, so a value that fails the pattern is a caller bug; enqueuing it
     * would spend a queue slot on an event the server is guaranteed to reject.
     */
    var satisfiesCatalogValueConstraints: Bool {
        switch self {
        case .catalogDeckInstallStarted(let packageSlug):
            return isAnalyticsCatalogSlug(value: packageSlug)
        default:
            return true
        }
    }
}

/// Mirrors `productAnalyticsSlugPattern`: `^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$`.
func isAnalyticsCatalogSlug(value: String) -> Bool {
    let characters = Array(value.utf8)
    guard characters.count >= 1 && characters.count <= 120 else {
        return false
    }

    func isLowercaseAlphanumeric(_ byte: UInt8) -> Bool {
        (byte >= 97 && byte <= 122) || (byte >= 48 && byte <= 57)
    }

    guard isLowercaseAlphanumeric(characters[0]) else {
        return false
    }
    guard characters.count > 1 else {
        return true
    }
    guard isLowercaseAlphanumeric(characters[characters.count - 1]) else {
        return false
    }

    for byte in characters[1..<(characters.count - 1)] {
        guard isLowercaseAlphanumeric(byte) || byte == 45 else {
            return false
        }
    }

    return true
}
