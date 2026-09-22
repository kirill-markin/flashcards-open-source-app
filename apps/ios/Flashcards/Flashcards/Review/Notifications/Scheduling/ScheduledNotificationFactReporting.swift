import Foundation

/**
 * `notification_scheduled` counts scheduled notifications, and reconciliation re-schedules the same
 * slots on every trigger — a permission change, a settings edit, a sync, a foreground return, every
 * recorded review — so an emit driven by a reconciliation pass alone would measure how often the app
 * reconciles.
 *
 * What makes the difference measurable is the slot a reminder occupies, which survives re-scheduling.
 * Each kind keeps a ledger of the slot ids it has reported; an id already in the ledger is a slot
 * that was reported once and is being re-scheduled, and reports nothing. Entries are dropped once
 * they expire, which bounds the ledger: an expired slot can never be scheduled again.
 *
 * A slot id names the OS slot only one reminder can occupy, so it is built from the reminder kind and
 * the wall clock it fires at, never from the scheduling request identifier. Request identifiers carry
 * the workspace, and only one workspace's reminders can be pending at a time because every reconcile
 * cancels them all first, so a workspace-scoped slot id would re-report the whole future chain on a
 * workspace switch — which is itself a reconcile trigger. Daily and strict slots expire at their fire
 * time; inactivity reminders need their own slot id, see `inactivityScheduledNotificationIdentities`.
 *
 * The ledger is not the persisted payload list the reconcilers keep. That list is emptied whenever
 * reminders are off, permission is missing or no workspace is loaded, and the same slots are written
 * again once the condition clears, which would count every such round trip as new reminders.
 */

/// One ledger per reminder kind, so the two reconcilers never overwrite each other's.
let reportedScheduledReviewNotificationsUserDefaultsKey: String = "reported-scheduled-review-notifications"
let reportedScheduledStrictRemindersUserDefaultsKey: String = "reported-scheduled-strict-reminders"

/// Distinct from the `review-notification::` and `strict-reminder::` request identifier prefixes:
/// a slot id is not a request identifier.
private let reviewReminderSlotIdentifierPrefix: String = "review-notification-slot::"
private let strictReminderSlotIdentifierPrefix: String = "strict-reminder-slot::"

private let slotIdWallClockDateFormat: String = "yyyy-MM-dd-HH-mm"
private let slotIdLocalDateFormat: String = "yyyy-MM-dd"

struct ScheduledNotificationIdentity: Hashable, Sendable {
    let slotId: String
    let expiresAtMillis: Int64
}

/// The ledger identities of one reconciled review reminder set.
func reviewReminderScheduledNotificationIdentities(
    mode: ReviewNotificationMode,
    payloads: [ScheduledReviewNotificationPayload],
    calendar: Calendar
) -> [ScheduledNotificationIdentity] {
    switch mode {
    case .daily:
        let dateFormatter = makeSlotIdDateFormatter(calendar: calendar, dateFormat: slotIdWallClockDateFormat)
        return payloads.map { payload in
            let wallClock = slotIdWallClock(
                scheduledAtMillis: payload.scheduledAtMillis,
                dateFormatter: dateFormatter
            )
            return ScheduledNotificationIdentity(
                slotId: "\(reviewReminderSlotIdentifierPrefix)daily::\(wallClock)",
                expiresAtMillis: payload.scheduledAtMillis
            )
        }
    case .inactivity:
        return inactivityScheduledNotificationIdentities(
            scheduledAtMillisList: payloads.map(\.scheduledAtMillis),
            calendar: calendar
        )
    }
}

/// The ledger identities of one reconciled strict reminder set.
func strictReminderScheduledNotificationIdentities(
    payloads: [ScheduledStrictReminderPayload],
    calendar: Calendar
) -> [ScheduledNotificationIdentity] {
    let dateFormatter = makeSlotIdDateFormatter(calendar: calendar, dateFormat: slotIdWallClockDateFormat)
    return payloads.map { payload in
        let wallClock = slotIdWallClock(
            scheduledAtMillis: payload.scheduledAtMillis,
            dateFormatter: dateFormatter
        )
        return ScheduledNotificationIdentity(
            slotId: "\(strictReminderSlotIdentifierPrefix)\(payload.offset.identifierComponent)::\(wallClock)",
            expiresAtMillis: payload.scheduledAtMillis
        )
    }
}

/// The inactivity chain is anchored on the last activity, and that anchor is rewritten by every
/// recorded review, so a fire time is not an identity: the whole chain shifts and gets fresh request
/// identifiers several times a minute while someone reviews, and at most one of those reminders can
/// ever fire. The identity is the local day and the position within it, expiring at the end of that
/// day rather than at a fire time the next re-anchor would move.
///
/// A day already counted therefore reports nothing when its chain shifts, which under-counts a
/// reminder that fires and is replaced within the same day — the direction that keeps the
/// denominator honest, since an inflated one cannot be repaired.
func inactivityScheduledNotificationIdentities(
    scheduledAtMillisList: [Int64],
    calendar: Calendar
) -> [ScheduledNotificationIdentity] {
    let dateFormatter = makeSlotIdDateFormatter(calendar: calendar, dateFormat: slotIdLocalDateFormat)
    var ordinalsByLocalDate: [String: Int] = [:]
    var identities: [ScheduledNotificationIdentity] = []
    for scheduledAtMillis in scheduledAtMillisList.sorted() {
        let scheduledAt = Date(timeIntervalSince1970: TimeInterval(scheduledAtMillis) / 1000)
        let localDate = dateFormatter.string(from: scheduledAt)
        let ordinal = ordinalsByLocalDate[localDate] ?? 0
        ordinalsByLocalDate[localDate] = ordinal + 1
        guard let nextLocalDayStart = calendar.date(
            byAdding: .day,
            value: 1,
            to: calendar.startOfDay(for: scheduledAt)
        ) else {
            continue
        }
        identities.append(
            ScheduledNotificationIdentity(
                slotId: "\(reviewReminderSlotIdentifierPrefix)inactivity::\(localDate)::\(ordinal)",
                expiresAtMillis: Int64(nextLocalDayStart.timeIntervalSince1970 * 1000)
            )
        )
    }

    return identities
}

/// The identities the ledger has not seen, in schedule order and each at most once.
func unreportedScheduledNotificationIdentities(
    identities: [ScheduledNotificationIdentity],
    reported: [String: Int64]
) -> [ScheduledNotificationIdentity] {
    var seenSlotIds = Set(reported.keys)
    var unreported: [ScheduledNotificationIdentity] = []
    for identity in identities where seenSlotIds.contains(identity.slotId) == false {
        seenSlotIds.insert(identity.slotId)
        unreported.append(identity)
    }

    return unreported
}

/// Adds every identity of this reconcile and drops the entries that have expired.
///
/// Already-reported slots are merged again rather than skipped so their expiry is refreshed to the
/// fire time this reconcile computed: a slot id names a wall-clock position rather than an instant,
/// so a zone change or a DST shift moves when it fires without changing the id, and a stale expiry
/// would prune the entry while its reminder is still pending and report the slot a second time.
func mergeReportedScheduledNotifications(
    reported: [String: Int64],
    identities: [ScheduledNotificationIdentity],
    nowMillis: Int64
) -> [String: Int64] {
    var merged = reported.filter { _, expiresAtMillis in
        expiresAtMillis > nowMillis
    }
    for identity in identities {
        merged[identity.slotId] = identity.expiresAtMillis
    }

    return merged
}

private func makeSlotIdDateFormatter(calendar: Calendar, dateFormat: String) -> DateFormatter {
    let dateFormatter = DateFormatter()
    dateFormatter.calendar = calendar
    dateFormatter.timeZone = calendar.timeZone
    dateFormatter.locale = Locale(identifier: "en_US_POSIX")
    dateFormatter.dateFormat = dateFormat
    return dateFormatter
}

private func slotIdWallClock(scheduledAtMillis: Int64, dateFormatter: DateFormatter) -> String {
    dateFormatter.string(from: Date(timeIntervalSince1970: TimeInterval(scheduledAtMillis) / 1000))
}

@MainActor
extension FlashcardsStore {
    /// Reports every scheduled notification this install has not reported before, then records them.
    func reportScheduledNotifications(
        notificationKind: AnalyticsNotificationKind,
        ledgerKey: String,
        identities: [ScheduledNotificationIdentity],
        nowMillis: Int64
    ) {
        let reported = self.loadReportedScheduledNotifications(ledgerKey: ledgerKey)
        let unreported = unreportedScheduledNotificationIdentities(
            identities: identities,
            reported: reported
        )
        for _ in unreported {
            Analytics.track(.notificationScheduled(notificationKind: notificationKind))
        }
        let merged = mergeReportedScheduledNotifications(
            reported: reported,
            identities: identities,
            nowMillis: nowMillis
        )
        // Reconciles run on every foreground, permission change, settings change, filter change and
        // recorded review, and the steady state changes nothing, so the encode and write is skipped.
        guard merged != reported else {
            return
        }
        self.saveReportedScheduledNotifications(ledgerKey: ledgerKey, reported: merged)
    }

    private func loadReportedScheduledNotifications(ledgerKey: String) -> [String: Int64] {
        guard let data = self.userDefaults.data(forKey: ledgerKey) else {
            return [:]
        }

        do {
            return try self.decoder.decode([String: Int64].self, from: data)
        } catch {
            captureReviewNotificationsSilentFailure(
                error: error,
                action: "reported_scheduled_notifications_load",
                stage: "decode",
                cloudSettings: self.cloudSettings,
                workspaceId: self.workspace?.workspaceId,
                configurationMode: try? self.currentCloudServiceConfiguration().mode
            )
            self.userDefaults.removeObject(forKey: ledgerKey)
            return [:]
        }
    }

    /// The stored ledger is left untouched when the encode fails, unlike the unreadable one the load
    /// path drops: it is still valid, and keeping it re-reports at most the slots this failed write
    /// would have recorded, while clearing it re-reports every pending slot on the next reconcile.
    private func saveReportedScheduledNotifications(ledgerKey: String, reported: [String: Int64]) {
        do {
            self.userDefaults.set(try self.encoder.encode(reported), forKey: ledgerKey)
        } catch {
            captureReviewNotificationsSilentFailure(
                error: error,
                action: "reported_scheduled_notifications_save",
                stage: "encode",
                cloudSettings: self.cloudSettings,
                workspaceId: self.workspace?.workspaceId,
                configurationMode: try? self.currentCloudServiceConfiguration().mode
            )
        }
    }
}
