import Foundation

let flashcardsUITestLaunchScenarioEnvironmentKey: String = "FLASHCARDS_UI_TEST_LAUNCH_SCENARIO"
let flashcardsUITestSelectedTabEnvironmentKey: String = "FLASHCARDS_UI_TEST_SELECTED_TAB"
private let flashcardsUITestAppNotificationTapTypeEnvironmentKey: String = "FLASHCARDS_UI_TEST_APP_NOTIFICATION_TAP_TYPE"
private let flashcardsUITestAIHandoffCardEnvironmentKey: String = "FLASHCARDS_UI_TEST_AI_HANDOFF_CARD"
@MainActor
private var hasConsumedFlashcardsUITestAppNotificationTapEnvironment: Bool = false

enum FlashcardsUITestSelectedTab: String {
    case review
    case progress
    case ai
    case cards
    case settings

    var appTab: AppTab {
        switch self {
        case .review:
            return .review
        case .progress:
            return .progress
        case .ai:
            return .ai
        case .cards:
            return .cards
        case .settings:
            return .settings
        }
    }
}

enum FlashcardsUITestAIHandoffCard: String {
    case firstCard = "first_card"
}

private enum FlashcardsUITestLaunchError: LocalizedError {
    case missingAIHandoffCard(FlashcardsUITestAIHandoffCard)

    var errorDescription: String? {
        switch self {
        case .missingAIHandoffCard(.firstCard):
            return "UI test AI handoff requested the first prepared card, but no UI test card is available."
        }
    }
}

@MainActor
func consumeFlashcardsUITestAppNotificationTapRequest(
    processInfo: ProcessInfo,
    workspaceId: String?
) -> AppNotificationTapRequest? {
    guard hasConsumedFlashcardsUITestAppNotificationTapEnvironment == false else {
        return nil
    }
    guard let appNotificationTapType = processInfo.environment[flashcardsUITestAppNotificationTapTypeEnvironmentKey] else {
        return nil
    }

    hasConsumedFlashcardsUITestAppNotificationTapEnvironment = true
    let userInfo: [AnyHashable: Any] = [
        appNotificationTapTypeUserInfoKey: appNotificationTapType
    ]
    let requestIdentifier: String?
    if appNotificationTapType == AppNotificationTapType.reviewReminder.rawValue,
       let workspaceId {
        requestIdentifier = makeReviewNotificationRequestIdentifier(
            workspaceId: workspaceId,
            kind: "ui-test",
            suffix: "launch"
        )
    } else {
        requestIdentifier = nil
    }
    return parseAppNotificationTapRequest(
        userInfo: userInfo,
        requestIdentifier: requestIdentifier
    )
}

@MainActor
func makeFlashcardsUITestAIHandoffCard(
    processInfo: ProcessInfo
) -> FlashcardsUITestAIHandoffCard? {
    guard let rawValue = processInfo.environment[flashcardsUITestAIHandoffCardEnvironmentKey] else {
        return nil
    }

    return FlashcardsUITestAIHandoffCard(rawValue: rawValue)
}

@MainActor
func makeFlashcardsUITestAIChatPresentationRequest(
    handoffCard: FlashcardsUITestAIHandoffCard,
    store: FlashcardsStore
) throws -> AIChatPresentationRequest {
    switch handoffCard {
    case .firstCard:
        guard let card = store.cards.first else {
            throw FlashcardsUITestLaunchError.missingAIHandoffCard(.firstCard)
        }

        return .attachCard(makeAIChatCardReference(card: card))
    }
}
