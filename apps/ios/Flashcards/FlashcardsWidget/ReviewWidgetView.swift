import SwiftUI
import WidgetKit

struct ReviewWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ReviewWidgetEntry

    var body: some View {
        Group {
            if let size = reviewWidgetSize(family: self.family) {
                ReviewWidgetContentView(size: size, entryDate: self.entry.date, content: self.entry.content)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .widgetURL(
                        makeWidgetDeepLinkURL(
                            deepLink: WidgetDeepLink(
                                destination: .review,
                                kind: .review,
                                workspaceId: self.entry.workspaceId,
                                size: size.deepLinkSize,
                                cardId: reviewWidgetShownCardId(size: size, content: self.entry.content)
                            )
                        )
                    )
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

/// The Home Screen families the Review widget supports.
private enum ReviewWidgetSize {
    case small
    case medium
    case large

    var deepLinkSize: WidgetDeepLinkSize {
        switch self {
        case .small:
            return .small
        case .medium:
            return .medium
        case .large:
            return .large
        }
    }
}

/// Nil only for families the widget does not declare as supported.
private func reviewWidgetSize(family: WidgetFamily) -> ReviewWidgetSize? {
    switch family {
    case .systemSmall:
        return .small
    case .systemMedium:
        return .medium
    case .systemLarge:
        return .large
    default:
        return nil
    }
}

/// The small family never shows a card, so its tap opens Review normally.
private func reviewWidgetShownCardId(size: ReviewWidgetSize, content: ReviewWidgetContent) -> String? {
    guard size != .small, case .due(_, let nextCard?, _) = content else {
        return nil
    }
    return nextCard.cardId
}

private struct ReviewWidgetContentView: View {
    let size: ReviewWidgetSize
    let entryDate: Date
    let content: ReviewWidgetContent

    var body: some View {
        switch self.content {
        case .noSnapshot:
            WidgetNoSnapshotView()
        case .due(let count, let nextCard, let streakDays):
            switch self.size {
            case .small:
                VStack(alignment: .leading, spacing: 0) {
                    ReviewWidgetDueCountView(count: count)
                    Spacer(minLength: 0)
                    if let streakDays {
                        ReviewWidgetStreakView(streakDays: streakDays)
                    }
                }
            case .medium:
                HStack(alignment: .top, spacing: 16) {
                    ReviewWidgetDueCountView(count: count)
                        .fixedSize(horizontal: true, vertical: false)
                    ReviewWidgetNextCardView(nextCard: nextCard, font: .headline, lineLimit: 4)
                }
            case .large:
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .top) {
                        ReviewWidgetDueCountView(count: count)
                        Spacer(minLength: 8)
                        if let streakDays {
                            ReviewWidgetStreakView(streakDays: streakDays)
                        }
                    }
                    ReviewWidgetNextCardView(nextCard: nextCard, font: .title3.weight(.semibold), lineLimit: 8)
                    Spacer(minLength: 0)
                }
            }
        case .allDone(let nextDueAt, let streakDays):
            // Medium shows the question and count only, so it omits the streak.
            ReviewWidgetAllDoneView(
                entryDate: self.entryDate,
                nextDueAt: nextDueAt,
                streakDays: self.size == .medium ? nil : streakDays
            )
        }
    }
}

private struct ReviewWidgetDueCountView: View {
    let count: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(self.count, format: .number)
                .font(.system(.largeTitle, design: .rounded, weight: .bold))
                .foregroundStyle(Color.accentColor)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .widgetAccentable()
            Text("widget.due_label", tableName: widgetStringsTableName)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
    }
}

private struct ReviewWidgetNextCardView: View {
    let nextCard: WidgetSnapshotCard?
    let font: Font
    let lineLimit: Int

    var body: some View {
        Group {
            if let nextCard {
                Text(verbatim: nextCard.frontPlainText)
                    .foregroundStyle(.primary)
            } else {
                Text("widget.cards_ready", tableName: widgetStringsTableName)
                    .foregroundStyle(.secondary)
            }
        }
        .font(self.font)
        .lineLimit(self.lineLimit)
        .multilineTextAlignment(.leading)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ReviewWidgetStreakView: View {
    let streakDays: Int

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "flame.fill")
                .foregroundStyle(Color.accentColor)
                .widgetAccentable()
            Text("widget.streak_days \(self.streakDays)", tableName: widgetStringsTableName)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .font(.caption.weight(.semibold))
    }
}

private struct ReviewWidgetAllDoneView: View {
    let entryDate: Date
    let nextDueAt: Date?
    let streakDays: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Image(systemName: "checkmark.circle.fill")
                .font(.title2)
                .foregroundStyle(Color.accentColor)
                .widgetAccentable()
            Text("widget.all_done.title", tableName: widgetStringsTableName)
                .font(.headline)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            if let nextDueAt {
                Text(
                    "widget.all_done.next_due \(reviewWidgetNextDueText(nextDueAt: nextDueAt, entryDate: self.entryDate))",
                    tableName: widgetStringsTableName
                )
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            }
            Spacer(minLength: 0)
            if let streakDays {
                ReviewWidgetStreakView(streakDays: streakDays)
            }
        }
    }
}

/// The next due time can be days away, so a later day also shows its date, and a later year its year.
private func reviewWidgetNextDueText(nextDueAt: Date, entryDate: Date) -> Text {
    let calendar = Calendar.current
    if calendar.isDate(nextDueAt, inSameDayAs: entryDate) {
        return Text(nextDueAt, style: .time)
    }
    let laterDayFormat = Date.FormatStyle.dateTime.month(.abbreviated).day().hour().minute()
    if calendar.isDate(nextDueAt, equalTo: entryDate, toGranularity: .year) {
        return Text(nextDueAt, format: laterDayFormat)
    }
    return Text(nextDueAt, format: laterDayFormat.year())
}
