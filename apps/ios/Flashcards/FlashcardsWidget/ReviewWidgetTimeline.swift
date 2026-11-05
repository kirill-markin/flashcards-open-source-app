import Foundation
import OSLog
import WidgetKit

private let reviewWidgetMaximumEntryCount: Int = 50

private let reviewWidgetLogger: Logger = Logger(
    subsystem: widgetBundleIdentifier(),
    category: "review_widget"
)

enum ReviewWidgetContent: Sendable, Equatable {
    case noSnapshot
    /// `nextCard` is nil when cards became due after the snapshot was written.
    case due(count: Int, nextCard: WidgetSnapshotCard?, streakDays: Int?)
    case allDone(nextDueAt: Date?, streakDays: Int?)
}

struct ReviewWidgetEntry: TimelineEntry, Sendable {
    let date: Date
    let workspaceId: String?
    let content: ReviewWidgetContent
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

/// One entry now and one per later due time, up to 50 entries, so the count grows as cards become due.
/// Past the last entry the count stays as it is until the app writes a new snapshot.
func makeReviewWidgetEntries(snapshot: WidgetSnapshot, now: Date) -> [ReviewWidgetEntry] {
    let laterDueDates = Array(Set(snapshot.upcomingDueAt.filter { dueAt in dueAt > now })).sorted()
    let entryDates = [now] + laterDueDates.prefix(reviewWidgetMaximumEntryCount - 1)
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
    return ReviewWidgetEntry(date: date, workspaceId: snapshot.workspaceId, content: content)
}

func makeNoSnapshotReviewWidgetEntry(date: Date) -> ReviewWidgetEntry {
    ReviewWidgetEntry(date: date, workspaceId: nil, content: .noSnapshot)
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
