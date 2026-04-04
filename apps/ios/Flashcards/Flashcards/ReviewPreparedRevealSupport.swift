import SwiftUI

struct PreparedReviewRevealState {
    let id: String
    let frontContent: ReviewRenderedContent
    let backContent: ReviewRenderedContent
    let frontSpeakableText: String
    let backSpeakableText: String
    let reviewAnswerGridOptions: ReviewAnswerGridOptions?
    let reviewAnswerOptionsErrorMessage: String?
}

func makePreparedReviewRevealStateId(
    card: Card,
    schedulerSettings: WorkspaceSchedulerSettings?
) -> String {
    let schedulerSettingsUpdatedAt = schedulerSettings?.updatedAt ?? "no-scheduler-settings"
    return "\(card.cardId)|\(card.updatedAt)|\(schedulerSettingsUpdatedAt)"
}

func makePreparedReviewRevealStatesTaskId(
    reviewQueue: [Card],
    schedulerSettings: WorkspaceSchedulerSettings?
) -> String {
    let currentCardStateId = currentReviewCard(reviewQueue: reviewQueue).map { card in
        makePreparedReviewRevealStateId(card: card, schedulerSettings: schedulerSettings)
    } ?? "no-current-card"
    let nextCardStateId = nextReviewCard(reviewQueue: reviewQueue).map { card in
        makePreparedReviewRevealStateId(card: card, schedulerSettings: schedulerSettings)
    } ?? "no-next-card"

    return "\(currentCardStateId)|\(nextCardStateId)"
}

func makePreparedReviewRevealState(
    card: Card,
    schedulerSettings: WorkspaceSchedulerSettings?,
    now: Date
) -> PreparedReviewRevealState {
    let frontContent = makeReviewRenderedContent(text: card.frontText)
    let backText = card.backText.isEmpty ? emptyBackTextPlaceholder : card.backText
    let backContent = makeReviewRenderedContent(text: backText)
    let frontSpeakableText = makeReviewSpeakableText(text: card.frontText)
    let backSpeakableText = makeReviewSpeakableText(text: card.backText)

    guard let schedulerSettings else {
        return PreparedReviewRevealState(
            id: makePreparedReviewRevealStateId(card: card, schedulerSettings: nil),
            frontContent: frontContent,
            backContent: backContent,
            frontSpeakableText: frontSpeakableText,
            backSpeakableText: backSpeakableText,
            reviewAnswerGridOptions: nil,
            reviewAnswerOptionsErrorMessage: "Scheduler settings are unavailable"
        )
    }

    do {
        let options = try makeReviewAnswerOptions(card: card, schedulerSettings: schedulerSettings, now: now)
        return PreparedReviewRevealState(
            id: makePreparedReviewRevealStateId(card: card, schedulerSettings: schedulerSettings),
            frontContent: frontContent,
            backContent: backContent,
            frontSpeakableText: frontSpeakableText,
            backSpeakableText: backSpeakableText,
            reviewAnswerGridOptions: try ReviewAnswerGridOptions(options: options),
            reviewAnswerOptionsErrorMessage: nil
        )
    } catch {
        return PreparedReviewRevealState(
            id: makePreparedReviewRevealStateId(card: card, schedulerSettings: schedulerSettings),
            frontContent: frontContent,
            backContent: backContent,
            frontSpeakableText: frontSpeakableText,
            backSpeakableText: backSpeakableText,
            reviewAnswerGridOptions: nil,
            reviewAnswerOptionsErrorMessage: Flashcards.errorMessage(error: error)
        )
    }
}

struct ReviewAnswerGridOptions {
    let easy: ReviewAnswerOption
    let good: ReviewAnswerOption
    let hard: ReviewAnswerOption
    let again: ReviewAnswerOption

    init(options: [ReviewAnswerOption]) throws {
        guard let easyOption = options.first(where: { option in
            option.rating == .easy
        }) else {
            throw ReviewViewError.missingReviewAnswerOption(.easy)
        }
        guard let goodOption = options.first(where: { option in
            option.rating == .good
        }) else {
            throw ReviewViewError.missingReviewAnswerOption(.good)
        }
        guard let hardOption = options.first(where: { option in
            option.rating == .hard
        }) else {
            throw ReviewViewError.missingReviewAnswerOption(.hard)
        }
        guard let againOption = options.first(where: { option in
            option.rating == .again
        }) else {
            throw ReviewViewError.missingReviewAnswerOption(.again)
        }

        self.easy = easyOption
        self.good = goodOption
        self.hard = hardOption
        self.again = againOption
    }
}

enum ReviewViewError: LocalizedError {
    case missingReviewAnswerOption(ReviewRating)

    var errorDescription: String? {
        switch self {
        case .missingReviewAnswerOption(let rating):
            return "Missing review answer option for \(rating.title)"
        }
    }
}
