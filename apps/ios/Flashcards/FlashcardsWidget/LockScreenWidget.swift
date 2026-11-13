import SwiftUI
import WidgetKit

let lockScreenWidgetKind: String = "LockScreenWidget"

struct LockScreenWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: lockScreenWidgetKind, provider: ReviewWidgetTimelineProvider()) { entry in
            LockScreenWidgetView(entry: entry)
        }
        .configurationDisplayName(Text("widget.lock_screen.gallery.name", tableName: widgetStringsTableName))
        .description(Text("widget.lock_screen.gallery.description", tableName: widgetStringsTableName))
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct LockScreenWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ReviewWidgetEntry

    var body: some View {
        Group {
            if let size = lockScreenWidgetSize(family: self.family) {
                LockScreenWidgetContentView(size: size, entry: self.entry)
                    .widgetURL(
                        makeWidgetDeepLinkURL(
                            deepLink: WidgetDeepLink(
                                destination: .review,
                                kind: .lockScreen,
                                workspaceId: self.entry.workspaceId,
                                size: size.deepLinkSize,
                                cardId: lockScreenWidgetShownCardId(size: size, content: self.entry.content),
                                revealAnswer: false
                            )
                        )
                    )
            }
        }
        .containerBackground(.clear, for: .widget)
    }
}

/// The Lock Screen families the widget supports.
private enum LockScreenWidgetSize {
    case circular
    case rectangular
    case inline

    var deepLinkSize: WidgetDeepLinkSize {
        switch self {
        case .circular:
            return .accessoryCircular
        case .rectangular:
            return .accessoryRectangular
        case .inline:
            return .accessoryInline
        }
    }
}

/// Nil only for families the widget does not declare as supported.
private func lockScreenWidgetSize(family: WidgetFamily) -> LockScreenWidgetSize? {
    switch family {
    case .accessoryCircular:
        return .circular
    case .accessoryRectangular:
        return .rectangular
    case .accessoryInline:
        return .inline
    default:
        return nil
    }
}

private struct LockScreenWidgetContentView: View {
    let size: LockScreenWidgetSize
    let entry: ReviewWidgetEntry

    var body: some View {
        switch self.size {
        case .circular:
            ZStack {
                AccessoryWidgetBackground()
                if let today = makeWidgetTodayProgress(entry: self.entry) {
                    WidgetPaceRingView(pace: today.pace, lineWidth: 4, numberFont: .title3)
                } else {
                    Image(systemName: "rectangle.stack.fill")
                        .font(.title3)
                        .widgetAccentable()
                }
            }
        case .rectangular:
            if let dueCount = widgetDueCount(content: self.entry.content) {
                LockScreenWidgetRectangularView(
                    dueCount: dueCount,
                    headlineText: lockScreenWidgetRectangularHeadline(entry: self.entry, dueCount: dueCount),
                    nextCard: lockScreenWidgetNextCard(content: self.entry.content)
                )
            } else {
                Text("widget.no_snapshot", tableName: widgetStringsTableName)
                    .font(.headline)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        case .inline:
            if let dueCount = widgetDueCount(content: self.entry.content) {
                if dueCount > 0 {
                    lockScreenWidgetInlineText(dueCount: dueCount, scheduledDueCount: self.entry.scheduledDueCount)
                } else {
                    Text("widget.all_done.title", tableName: widgetStringsTableName)
                }
            } else {
                Text("widget.no_snapshot", tableName: widgetStringsTableName)
            }
        }
    }
}

/// The scheduled due cards and the minutes to clear them; the To review count when the snapshot has no split yet.
private func lockScreenWidgetRectangularHeadline(entry: ReviewWidgetEntry, dueCount: Int) -> Text {
    guard let scheduledDueCount = entry.scheduledDueCount else {
        return Text("widget.lock_screen.to_review \(dueCount)", tableName: widgetStringsTableName)
    }
    return widgetScheduledDueText(
        scheduledDueCount: scheduledDueCount,
        minutes: widgetReviewTimeEstimateMinutes(entry: entry)
    )
}

/// "Due" alone would read as the To review count, so the inline line names both.
private func lockScreenWidgetInlineText(dueCount: Int, scheduledDueCount: Int?) -> Text {
    let toReviewText = Text("widget.lock_screen.to_review \(dueCount)", tableName: widgetStringsTableName)
    guard let scheduledDueCount else {
        return toReviewText
    }
    return toReviewText
        + Text(verbatim: " · ")
        + Text("widget.scheduled_due \(scheduledDueCount)", tableName: widgetStringsTableName)
}

/// One tap opens the shown card; the family is too small for a Reveal answer button.
private struct LockScreenWidgetRectangularView: View {
    let dueCount: Int
    let headlineText: Text
    let nextCard: WidgetSnapshotCard?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            self.headlineText
                .font(.headline)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                // Laid out first, so a tall question script truncates instead of pushing this line out.
                .layoutPriority(1)
                .widgetAccentable()
            Group {
                if self.dueCount == 0 {
                    Text("widget.all_done.title", tableName: widgetStringsTableName)
                } else if let nextCard = self.nextCard {
                    Text(verbatim: nextCard.frontPlainText)
                } else {
                    Text("widget.cards_ready", tableName: widgetStringsTableName)
                }
            }
            .lineLimit(2)
            // Two full-size lines under the due line are a point or two taller than the rectangular family.
            .minimumScaleFactor(0.85)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Only the rectangular family shows a card, so only its tap opens that card.
private func lockScreenWidgetShownCardId(size: LockScreenWidgetSize, content: ReviewWidgetContent) -> String? {
    guard size == .rectangular else {
        return nil
    }
    return lockScreenWidgetNextCard(content: content)?.cardId
}

/// `nextCard` is the question only; nil when nothing is due or the card is not known yet.
private func lockScreenWidgetNextCard(content: ReviewWidgetContent) -> WidgetSnapshotCard? {
    guard case .due(_, let nextCard, _) = content else {
        return nil
    }
    return nextCard
}
