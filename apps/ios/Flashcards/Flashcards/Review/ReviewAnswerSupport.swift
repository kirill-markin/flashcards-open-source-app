import Foundation

private let reviewAnswerPresentationOrder: [ReviewRating] = [.again, .hard, .good, .easy]
private let reviewCardsStringsTableName: String = "ReviewCards"
private let reviewIntervalFormatter: DateComponentsFormatter = {
    let formatter = DateComponentsFormatter()
    formatter.unitsStyle = .full
    formatter.maximumUnitCount = 1
    formatter.includesApproximationPhrase = false
    formatter.includesTimeRemainingPhrase = false
    return formatter
}()

struct ReviewAnswerOption: Hashable, Identifiable {
    let rating: ReviewRating
    let intervalDescription: String

    var id: Int {
        rating.rawValue
    }
}

func localizedReviewRatingTitle(rating: ReviewRating) -> String {
    switch rating {
    case .again:
        return String(localized: "Again", table: reviewCardsStringsTableName)
    case .hard:
        return String(localized: "Hard", table: reviewCardsStringsTableName)
    case .good:
        return String(localized: "Good", table: reviewCardsStringsTableName)
    case .easy:
        return String(localized: "Easy", table: reviewCardsStringsTableName)
    }
}

func formatReviewIntervalText(now: Date, dueAt: Date) -> String {
    let durationSeconds = max(Int(dueAt.timeIntervalSince(now)), 0)

    if durationSeconds < 60 {
        return String(localized: "in less than a minute", table: reviewCardsStringsTableName)
    }

    let localizedInterval: String
    let durationMinutes = durationSeconds / 60
    if durationMinutes < 60,
       let formattedInterval = reviewIntervalFormatter.string(from: TimeInterval(durationMinutes * 60)) {
        localizedInterval = formattedInterval
    } else {
        let durationHours = durationMinutes / 60
        if durationHours < 24,
           let formattedInterval = reviewIntervalFormatter.string(from: TimeInterval(durationHours * 3_600)) {
            localizedInterval = formattedInterval
        } else {
            let durationDays = durationHours / 24
            localizedInterval = reviewIntervalFormatter.string(from: TimeInterval(durationDays * 86_400))
                ?? durationDays.formatted()
        }
    }

    return String(
        format: String(localized: "in %@", table: reviewCardsStringsTableName),
        locale: Locale.current,
        localizedInterval
    )
}

func makeReviewAnswerOptions(card: Card, schedulerSettings: WorkspaceSchedulerSettings, now: Date) throws -> [ReviewAnswerOption] {
    try reviewAnswerPresentationOrder.map { rating in
        let schedule = try computeReviewSchedule(
            card: card,
            settings: schedulerSettings,
            rating: rating,
            now: now
        )

        return ReviewAnswerOption(
            rating: rating,
            intervalDescription: formatReviewIntervalText(now: now, dueAt: schedule.dueAt)
        )
    }
}
