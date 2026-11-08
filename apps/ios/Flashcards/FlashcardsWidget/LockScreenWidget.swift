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
                                cardId: lockScreenWidgetShownCardId(size: size, content: self.entry.content)
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
            if let progress = makeWidgetTodayProgress(entry: self.entry) {
                LockScreenWidgetCircularView(progress: progress)
            } else {
                ZStack {
                    AccessoryWidgetBackground()
                    Image(systemName: "rectangle.stack.fill")
                        .font(.title3)
                        .widgetAccentable()
                }
            }
        case .rectangular:
            if let dueCount = widgetDueCount(content: self.entry.content) {
                LockScreenWidgetRectangularView(
                    dueCount: dueCount,
                    nextCard: lockScreenWidgetNextCard(content: self.entry.content),
                    streakDays: self.entry.snapshot?.progress?.currentStreakDays
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
                    lockScreenWidgetDueText(
                        dueCount: dueCount,
                        streakDays: self.entry.snapshot?.progress?.currentStreakDays
                    )
                } else {
                    Text("widget.all_done.title", tableName: widgetStringsTableName)
                }
            } else {
                Text("widget.no_snapshot", tableName: widgetStringsTableName)
            }
        }
    }
}

private struct LockScreenWidgetCircularView: View {
    let progress: WidgetTodayProgress

    var body: some View {
        Gauge(value: self.progress.fraction) {
            Text("widget.today.title", tableName: widgetStringsTableName)
        } currentValueLabel: {
            Text(self.progress.leftCount, format: .number.notation(.compactName))
                .font(.system(.title3, design: .rounded, weight: .bold))
                .lineLimit(1)
                .minimumScaleFactor(0.5)
        }
        .gaugeStyle(.accessoryCircularCapacity)
        .widgetAccentable()
    }
}

private struct LockScreenWidgetRectangularView: View {
    let dueCount: Int
    let nextCard: WidgetSnapshotCard?
    let streakDays: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            lockScreenWidgetDueText(dueCount: self.dueCount, streakDays: self.streakDays)
                .font(.headline)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
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
            .lineLimit(1)
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

/// The streak part is hidden until Progress has loaded.
private func lockScreenWidgetDueText(dueCount: Int, streakDays: Int?) -> Text {
    guard let streakDays else {
        return Text("widget.lock_screen.due \(dueCount)", tableName: widgetStringsTableName)
    }
    return Text("widget.lock_screen.due_streak \(dueCount) \(streakDays)", tableName: widgetStringsTableName)
}
