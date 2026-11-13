import SwiftUI
import WidgetKit

let questionWidgetKind: String = "QuestionWidget"

struct QuestionWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: questionWidgetKind, provider: QuestionWidgetTimelineProvider()) { entry in
            QuestionWidgetView(entry: entry)
        }
        .configurationDisplayName(Text("widget.question.gallery.name", tableName: widgetStringsTableName))
        .description(Text("widget.question.gallery.description", tableName: widgetStringsTableName))
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

/// The Review timeline plus an entry at each slot hour, when the widget moves on to the next card.
struct QuestionWidgetTimelineProvider: TimelineProvider {
    private let reviewProvider: ReviewWidgetTimelineProvider = ReviewWidgetTimelineProvider()

    func placeholder(in context: Context) -> ReviewWidgetEntry {
        self.reviewProvider.placeholder(in: context)
    }

    func getSnapshot(in context: Context, completion: @escaping (ReviewWidgetEntry) -> Void) {
        self.reviewProvider.getSnapshot(in: context, completion: completion)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ReviewWidgetEntry>) -> Void) {
        let now = Date()
        guard let snapshot = loadReviewWidgetSnapshot() else {
            completion(Timeline(entries: [makeNoSnapshotReviewWidgetEntry(date: now)], policy: .never))
            return
        }
        completion(
            Timeline(
                entries: makeReviewWidgetEntries(
                    snapshot: snapshot,
                    now: now,
                    reservedDates: questionWidgetUpcomingSlotStarts(now: now)
                ),
                policy: .never
            )
        )
    }
}

struct QuestionWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ReviewWidgetEntry

    var body: some View {
        Group {
            if let size = questionWidgetSize(family: self.family) {
                let card = questionWidgetCard(entry: self.entry)
                QuestionWidgetContentView(size: size, entry: self.entry, card: card)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .widgetURL(
                        makeWidgetDeepLinkURL(
                            deepLink: WidgetDeepLink(
                                destination: .review,
                                kind: .question,
                                workspaceId: self.entry.workspaceId,
                                size: size.deepLinkSize,
                                cardId: card?.cardId,
                                revealAnswer: false
                            )
                        )
                    )
            }
        }
        .homeScreenWidgetStyle(accentColor: self.entry.snapshot?.accentColor)
    }
}

/// The Home Screen families the Question widget supports.
private enum QuestionWidgetSize {
    case small
    case medium

    var deepLinkSize: WidgetDeepLinkSize {
        switch self {
        case .small:
            return .small
        case .medium:
            return .medium
        }
    }
}

/// Nil only for families the widget does not declare as supported.
private func questionWidgetSize(family: WidgetFamily) -> QuestionWidgetSize? {
    switch family {
    case .systemSmall:
        return .small
    case .systemMedium:
        return .medium
    default:
        return nil
    }
}

private struct QuestionWidgetContentView: View {
    let size: QuestionWidgetSize
    let entry: ReviewWidgetEntry
    let card: WidgetSnapshotCard?

    var body: some View {
        switch self.entry.content {
        case .noSnapshot:
            WidgetNoSnapshotView()
        case .allDone(let nextDueAt, _):
            ReviewWidgetAllDoneView(entryDate: self.entry.date, nextDueAt: nextDueAt, streakDays: nil)
        case .due:
            VStack(alignment: .leading, spacing: 8) {
                ReviewWidgetNextCardView(
                    nextCard: self.card,
                    font: self.size == .small ? .headline : .title3.weight(.semibold),
                    lineLimit: self.size == .small ? 5 : 3,
                    reservesLines: false
                )
                Spacer(minLength: 0)
                HStack(alignment: .center, spacing: 8) {
                    if self.size == .medium, let scheduledDueCount = self.entry.scheduledDueCount {
                        ReviewWidgetScheduledDueView(scheduledDueCount: scheduledDueCount, minutes: nil)
                        Spacer(minLength: 0)
                    }
                    if let card = self.card {
                        WidgetRevealAnswerButton(
                            deepLink: makeWidgetRevealAnswerDeepLink(
                                kind: .question,
                                workspaceId: self.entry.workspaceId,
                                size: self.size.deepLinkSize,
                                cardId: card.cardId
                            )
                        )
                    }
                }
            }
        }
    }
}
