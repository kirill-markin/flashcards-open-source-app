import Foundation
import OSLog
import WidgetKit

private let reviewWidgetMaximumEntryCount: Int = 50

let reviewWidgetLogger: Logger = Logger(
    subsystem: widgetBundleIdentifier(),
    category: "review_widget"
)

enum ReviewWidgetContent: Sendable, Equatable {
    case noSnapshot
    /// The saved Review filter may have no ready card while the workspace does.
    case due(count: Int, nextCard: WidgetSnapshotCard?, streakDays: Int?)
    case allDone(nextDueAt: Date?, streakDays: Int?)
}

struct ReviewWidgetEntry: TimelineEntry, Sendable {
    let date: Date
    let workspaceId: String?
    let content: ReviewWidgetContent
    /// The decoded snapshot behind `content`, for widget kinds that show more than Review; nil without one.
    let snapshot: WidgetSnapshot?
}

struct ReviewWidgetTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> ReviewWidgetEntry {
        makeNoSnapshotReviewWidgetEntry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (ReviewWidgetEntry) -> Void) {
        let now = Date()
        guard let snapshot = loadReviewWidgetSnapshot() else {
            completion(makeNoSnapshotReviewWidgetEntry(date: now))
            return
        }
        completion(makeReviewWidgetEntry(snapshot: snapshot, date: now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ReviewWidgetEntry>) -> Void) {
        let now = Date()
        // The app reloads timelines whenever it writes a new snapshot.
        guard let snapshot = loadReviewWidgetSnapshot() else {
            completion(Timeline(entries: [makeNoSnapshotReviewWidgetEntry(date: now)], policy: .never))
            return
        }
        completion(Timeline(entries: makeReviewWidgetEntries(snapshot: snapshot, now: now), policy: .never))
    }
}

/// One entry now, one per later due time up to the cap, and always one at the next local midnight,
/// so the count grows as cards become due and day-based widgets roll over to the new day.
/// Past the last entry the content stays as it is until the app writes a new snapshot.
func makeReviewWidgetEntries(snapshot: WidgetSnapshot, now: Date) -> [ReviewWidgetEntry] {
    // Two slots stay reserved: `now` and the next local midnight.
    let laterDueDates = Set(snapshot.upcomingDueAt.filter { dueAt in dueAt > now })
        .sorted()
        .prefix(reviewWidgetMaximumEntryCount - 2)
    let laterDates = Set(laterDueDates + [widgetNextLocalDayStart(after: now)]).sorted()
    let entryDates = [now] + laterDates
    return entryDates.map { entryDate in
        makeReviewWidgetEntry(snapshot: snapshot, date: entryDate)
    }
}

func makeReviewWidgetEntry(snapshot: WidgetSnapshot, date: Date) -> ReviewWidgetEntry {
    let becameDueCount = snapshot.upcomingDueAt.filter { dueAt in dueAt <= date }.count
    let dueCount = snapshot.dueCount + becameDueCount
    let content: ReviewWidgetContent
    if dueCount > 0 {
        content = .due(count: dueCount, nextCard: snapshot.nextCard, streakDays: snapshot.streakDays)
    } else {
        content = .allDone(
            nextDueAt: snapshot.upcomingDueAt.first { dueAt in dueAt > date },
            streakDays: snapshot.streakDays
        )
    }
    return ReviewWidgetEntry(date: date, workspaceId: snapshot.workspaceId, content: content, snapshot: snapshot)
}

func makeNoSnapshotReviewWidgetEntry(date: Date) -> ReviewWidgetEntry {
    ReviewWidgetEntry(date: date, workspaceId: nil, content: .noSnapshot, snapshot: nil)
}

/// A read failure renders the no-snapshot state; the next app write replaces the file.
private func loadReviewWidgetSnapshot() -> WidgetSnapshot? {
    do {
        return try readWidgetSnapshot(fileURL: try widgetSnapshotFileURL())
    } catch {
        reviewWidgetLogger.error(
            "event=review_widget_snapshot_read_failed error=\(String(describing: error), privacy: .public)"
        )
        return nil
    }
}

private func widgetBundleIdentifier() -> String {
    guard let bundleIdentifier = Bundle.main.bundleIdentifier else {
        preconditionFailure("Widget extension bundle has no CFBundleIdentifier.")
    }
    return bundleIdentifier
}
