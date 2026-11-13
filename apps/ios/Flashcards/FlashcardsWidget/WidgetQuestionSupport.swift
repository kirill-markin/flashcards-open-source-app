import SwiftUI
import WidgetKit

/// The local hours at which the Question widget moves on to the next card.
private let questionWidgetSlotHours: [Int] = [6, 12, 16, 20]

/// The deep link of a Reveal answer button: Review on `cardId`, answer-side.
func makeWidgetRevealAnswerDeepLink(
    kind: WidgetDeepLinkKind,
    workspaceId: String?,
    size: WidgetDeepLinkSize,
    cardId: String
) -> WidgetDeepLink {
    WidgetDeepLink(
        destination: .review,
        kind: kind,
        workspaceId: workspaceId,
        size: size,
        cardId: cardId,
        revealAnswer: true
    )
}

/// Opens the card answer-side in the app through `RevealAnswerIntent`; the widget itself never shows the answer.
struct WidgetRevealAnswerButton: View {
    @Environment(\.widgetAccent) private var accent
    let deepLink: WidgetDeepLink

    var body: some View {
        Button(intent: RevealAnswerIntent(deepLink: self.deepLink)) {
            Text("widget.reveal_answer", tableName: widgetStringsTableName)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(self.accent.filledLabelColor)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.capsule)
        .controlSize(.small)
        .tint(self.accent.color)
        .widgetAccentable()
    }
}

/// The scheduled due count, with the minutes to clear it when known; a check mark at 0 due.
func widgetScheduledDueText(scheduledDueCount: Int, minutes: Int?) -> Text {
    let dueText = Text("widget.scheduled_due \(scheduledDueCount)", tableName: widgetStringsTableName)
    if scheduledDueCount == 0 {
        return Text(Image(systemName: "checkmark")) + Text(verbatim: " ") + dueText
    }
    guard let minutes else {
        return dueText
    }
    return dueText + Text(verbatim: " · ") + Text("widget.minutes \(minutes)", tableName: widgetStringsTableName)
}

/// The cards a widget rotates through: the snapshot's next cards, or its single next card from an older file.
private func widgetQuestionCards(snapshot: WidgetSnapshot) -> [WidgetSnapshotCard] {
    if let nextCards = snapshot.nextCards {
        return nextCards
    }
    return snapshot.nextCard.map { nextCard in [nextCard] } ?? []
}

/// The Question widget's card at the entry date: the next card when the app wrote the snapshot, then the following
/// one at each slot hour since. Nil while nothing is due or the saved filter has no card to preview.
func questionWidgetCard(entry: ReviewWidgetEntry) -> WidgetSnapshotCard? {
    guard case .due = entry.content, let snapshot = entry.snapshot else {
        return nil
    }
    let cards = widgetQuestionCards(snapshot: snapshot)
    guard cards.isEmpty == false else {
        return nil
    }
    let slotIndex = questionWidgetSlotStarts(after: snapshot.generatedAt, through: entry.date).count
    return cards[slotIndex % cards.count]
}

/// The slot starts in the 24 hours after `now`, for the Question widget's timeline.
func questionWidgetUpcomingSlotStarts(now: Date) -> [Date] {
    let calendar = makeWidgetLocalCalendar()
    guard let dayAfter = calendar.date(byAdding: .day, value: 1, to: now) else {
        preconditionFailure("Question widget slot window could not be calculated for \(now).")
    }
    return questionWidgetSlotStarts(after: now, through: dayAfter)
}

/// Slot starts strictly after `start` and no later than `end`, ascending.
private func questionWidgetSlotStarts(after start: Date, through end: Date) -> [Date] {
    guard end > start else {
        return []
    }
    let calendar = makeWidgetLocalCalendar()
    var slotStarts: [Date] = []
    var dayStart = calendar.startOfDay(for: start)
    while dayStart <= end {
        for hour in questionWidgetSlotHours {
            guard let slotStart = calendar.date(bySettingHour: hour, minute: 0, second: 0, of: dayStart) else {
                preconditionFailure("Question widget slot \(hour) could not be calculated for \(dayStart).")
            }
            if slotStart > start && slotStart <= end {
                slotStarts.append(slotStart)
            }
        }
        dayStart = widgetNextLocalDayStart(after: dayStart)
    }
    return slotStarts
}
