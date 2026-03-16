import Foundation

private let reviewAnswerPresentationOrder: [ReviewRating] = [.easy, .good, .hard, .again]

struct ReviewAnswerOption: Hashable, Identifiable {
    let rating: ReviewRating
    let intervalDescription: String

    var id: Int {
        rating.rawValue
    }
}

func formatReviewIntervalText(now: Date, dueAt: Date) -> String {
    let durationSeconds = max(Int(dueAt.timeIntervalSince(now)), 0)

    if durationSeconds < 60 {
        return "in less than a minute"
    }

    let durationMinutes = durationSeconds / 60
    if durationMinutes < 60 {
        return "in \(durationMinutes) minute\(durationMinutes == 1 ? "" : "s")"
    }

    let durationHours = durationMinutes / 60
    if durationHours < 24 {
        return "in \(durationHours) hour\(durationHours == 1 ? "" : "s")"
    }

    let durationDays = durationHours / 24
    return "in \(durationDays) day\(durationDays == 1 ? "" : "s")"
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
