import Foundation

enum LiveSmokeIdentifier {
    static let cloudWorkspaceChooserScreen: String = "cloudSignIn.workspaceChooserScreen"
    static let cloudSignInScreen: String = "cloudSignIn.screen"
    static let reviewScreen: String = "review.screen"
    static let cardsScreen: String = "cards.screen"
    static let aiScreen: String = "ai.screen"
    static let settingsScreen: String = "settings.screen"
    static let settingsCurrentWorkspaceRow: String = "settings.currentWorkspaceRow"
    static let settingsWorkspaceSettingsRow: String = "settings.workspaceSettingsRow"
    static let settingsAccountSettingsRow: String = "settings.accountSettingsRow"
    static let currentWorkspaceScreen: String = "currentWorkspace.screen"
    static let accountSettingsAccountStatusRow: String = "accountSettings.accountStatusRow"
    static let accountSettingsDangerZoneRow: String = "accountSettings.dangerZoneRow"
    static let workspaceSettingsScreen: String = "workspaceSettings.screen"
    static let workspaceOverviewScreen: String = "workspaceOverview.screen"
    static let workspaceOverviewDueCount: String = "workspaceOverview.dueCount"
    static let workspaceOverviewNewCount: String = "workspaceOverview.newCount"
    static let workspaceOverviewReviewedCount: String = "workspaceOverview.reviewedCount"
    static let workspaceSettingsResetProgressButton: String = "workspaceSettings.resetProgressButton"
    static let accountSettingsScreen: String = "accountSettings.screen"
    static let accountStatusScreen: String = "accountStatus.screen"
    static let dangerZoneScreen: String = "dangerZone.screen"
    static let dangerZoneDeleteAccountButton: String = "dangerZone.deleteAccountButton"
    static let resetWorkspaceProgressConfirmationPhrase: String = "resetWorkspaceProgress.confirmationPhrase"
    static let resetWorkspaceProgressConfirmationField: String = "resetWorkspaceProgress.confirmationField"
    static let resetWorkspaceProgressContinueButton: String = "resetWorkspaceProgress.continueButton"
    static let resetWorkspaceProgressCardsCount: String = "resetWorkspaceProgress.cardsToResetCount"
    static let resetWorkspaceProgressButton: String = "resetWorkspaceProgress.resetButton"
    static let accountStatusSignInButton: String = "accountStatus.signInButton"
    static let accountStatusLinkedEmailValue: String = "accountStatus.linkedEmailValue"
    static let accountStatusSyncNowButton: String = "accountStatus.syncNowButton"
    static let accountStatusSwitchAccountButton: String = "accountStatus.switchAccountButton"
    static let accountStatusLogoutButton: String = "accountStatus.logoutButton"
    static let cloudSignInEmailField: String = "cloudSignIn.emailField"
    static let cloudSignInSendCodeButton: String = "cloudSignIn.sendCodeButton"
    static let cloudSignInCreateWorkspaceButton: String = "cloudSignIn.createWorkspaceButton"
    static let currentWorkspaceRowButton: String = "currentWorkspace.rowButton"
    static let currentWorkspacePickerScreen: String = "currentWorkspace.pickerScreen"
    static let currentWorkspaceCreateButton: String = "currentWorkspace.createButton"
    static let workspaceSettingsOverviewRow: String = "workspaceSettings.overviewRow"
    static let workspaceOverviewNameField: String = "workspaceOverview.nameField"
    static let workspaceOverviewSaveNameButton: String = "workspaceOverview.saveNameButton"
    static let workspaceOverviewDeleteWorkspaceButton: String = "workspaceOverview.deleteWorkspaceButton"
    static let deleteWorkspaceConfirmationPhrase: String = "deleteWorkspace.confirmationPhrase"
    static let deleteWorkspaceConfirmationField: String = "deleteWorkspace.confirmationField"
    static let deleteWorkspaceConfirmationButton: String = "deleteWorkspace.confirmationButton"
    static let cardsAddButton: String = "cards.addButton"
    static let cardsCardRow: String = "cards.cardRow"
    static let cardEditorScreen: String = "cardEditor.screen"
    static let cardEditorEditWithAIButton: String = "cardEditor.editWithAIButton"
    static let cardEditorFrontRow: String = "cardEditor.frontRow"
    static let cardEditorBackRow: String = "cardEditor.backRow"
    static let cardEditorSaveButton: String = "cardEditor.saveButton"
    static let cardEditorFrontTextEditor: String = "cardEditor.frontTextEditor"
    static let cardEditorBackTextEditor: String = "cardEditor.backTextEditor"
    static let reviewShowAnswerButton: String = "review.showAnswerButton"
    static let reviewAiButton: String = "review.aiButton"
    static let reviewRateGoodButton: String = "review.rateGoodButton"
    static let aiConsentAcceptButton: String = "ai.consentAcceptButton"
    static let aiNewChatButton: String = "ai.newChatButton"
    static let aiEmptyState: String = "ai.emptyState"
    static let aiMessageRow: String = "ai.messageRow"
    static let aiComposerTextField: String = "ai.composerTextField"
    static let aiComposerSendButton: String = "ai.composerSendButton"
    static let aiComposerCardAttachmentChip: String = "ai.composerCardAttachmentChip"
    static let aiComposerSuggestionRow: String = "ai.composerSuggestionRow"
    static let aiComposerSuggestionPrefix: String = "ai.composerSuggestion."
    static let aiToolCallSummary: String = "ai.toolCallSummary"
    static let aiToolCallRequestText: String = "ai.toolCallRequestText"
    static let aiToolCallResponseText: String = "ai.toolCallResponseText"
    static let aiToolCallCompletedStatus: String = "ai.toolCallCompletedStatus"
    static let aiAssistantErrorMessage: String = "ai.assistantErrorMessage"
    static let aiAssistantVisibleText: String = "ai.assistantVisibleText"
}

enum LiveSmokeLaunchResetState: String {
    case localGuest = "local_guest"
    case localGuestSeededManualReviewCard = "local_guest_seeded_manual_review_card"
    case localGuestSeededAIReviewCard = "local_guest_seeded_ai_review_card"
}

enum LiveSmokeSelectedTab: String {
    case review
    case cards
    case ai
    case settings

    var localizationKey: String {
        switch self {
        case .review:
            return "root_tab.review.title"
        case .cards:
            return "root_tab.cards.title"
        case .ai:
            return "root_tab.ai.title"
        case .settings:
            return "root_tab.settings.title"
        }
    }

    var screen: LiveSmokeScreen {
        switch self {
        case .review:
            return .review
        case .cards:
            return .cards
        case .ai:
            return .ai
        case .settings:
            return .settings
        }
    }

    func localizedTabBarButtonLabel(localization: LiveSmokeLaunchLocalization) throws -> String {
        try LiveSmokeLocalizationCatalog.localizedString(
            key: self.localizationKey,
            localization: localization
        )
    }
}

enum LiveSmokeAppNotificationTapType: String {
    case reviewReminder = "reviewReminder"
    case unsupported = "unsupported"
}

enum LiveSmokeScreen: CaseIterable {
    case review
    case cards
    case ai
    case settings
    case currentWorkspace
    case workspaceSettings
    case workspaceOverview
    case accountSettings
    case accountStatus
    case dangerZone

    var identifier: String {
        switch self {
        case .review:
            return LiveSmokeIdentifier.reviewScreen
        case .cards:
            return LiveSmokeIdentifier.cardsScreen
        case .ai:
            return LiveSmokeIdentifier.aiScreen
        case .settings:
            return LiveSmokeIdentifier.settingsScreen
        case .currentWorkspace:
            return LiveSmokeIdentifier.currentWorkspaceScreen
        case .workspaceSettings:
            return LiveSmokeIdentifier.workspaceSettingsScreen
        case .workspaceOverview:
            return LiveSmokeIdentifier.workspaceOverviewScreen
        case .accountSettings:
            return LiveSmokeIdentifier.accountSettingsScreen
        case .accountStatus:
            return LiveSmokeIdentifier.accountStatusScreen
        case .dangerZone:
            return LiveSmokeIdentifier.dangerZoneScreen
        }
    }

    var title: String {
        switch self {
        case .review:
            return "Review"
        case .cards:
            return "Cards"
        case .ai:
            return "AI"
        case .settings:
            return "Settings"
        case .currentWorkspace:
            return "Current Workspace"
        case .workspaceSettings:
            return "Workspace Settings"
        case .workspaceOverview:
            return "Workspace Overview"
        case .accountSettings:
            return "Account Settings"
        case .accountStatus:
            return "Account Status"
        case .dangerZone:
            return "Danger Zone"
        }
    }
}

struct LiveSmokeBreadcrumb {
    let line: String
}

struct LiveSmokeRunContext {
    let workspaceName: String
    let manualFrontText: String
    let manualBackText: String
}

struct LiveSmokeAIToolCallCheck {
    let matchingInsertFound: Bool
    let completedSqlSummaries: [String]
}

enum LiveSmokeSeededData {
    static let manualReviewFrontText: String = "Smoke seeded manual review question"
    static let aiReviewFrontText: String = "Smoke seeded AI review question"
}

let aiComposerPlaceholderText: String = "Ask about cards, review history, or propose a change..."
let aiCreatePromptText: String = "I give you all permissions. Please create one test flashcard now."
let aiResetPromptText: String = "Reply with exactly: reset ok"
let aiCreatePromptMaximumAttempts: Int = 3
let aiResetPromptMaximumAttempts: Int = 3
let aiCreateRunCompletionTimeoutSeconds: TimeInterval = 90
let liveSmokeFocusPollIntervalSeconds: TimeInterval = 0.2
let aiConsentRetryTapIntervalSeconds: TimeInterval = 1

private enum LiveSmokeLocalizationCatalog {
    static func localizedString(
        key: String,
        localization: LiveSmokeLaunchLocalization
    ) throws -> String {
        let catalog = try Self.catalogLoadResult.get()
        let catalogPath = Self.catalogURL.path

        guard let entry = catalog.strings[key] else {
            throw LiveSmokeLocalizationCatalogError.missingKey(
                key: key,
                catalogPath: catalogPath
            )
        }

        guard let localizations = entry.localizations,
              let localizationEntry = localizations[localization.appleLanguage] else {
            throw LiveSmokeLocalizationCatalogError.missingLocalization(
                key: key,
                localization: localization.appleLanguage,
                catalogPath: catalogPath
            )
        }

        guard let value = localizationEntry.stringUnit?.value,
              value.isEmpty == false else {
            throw LiveSmokeLocalizationCatalogError.missingValue(
                key: key,
                localization: localization.appleLanguage,
                catalogPath: catalogPath
            )
        }

        return value
    }

    private static let catalogURL: URL = {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Flashcards/Resources/Localization/Foundation.xcstrings")
    }()

    private static let catalogLoadResult: Result<LiveSmokeXCStringsCatalog, LiveSmokeLocalizationCatalogError> =
        Self.loadCatalog()

    private static func loadCatalog() -> Result<LiveSmokeXCStringsCatalog, LiveSmokeLocalizationCatalogError> {
        let catalogPath = Self.catalogURL.path

        guard FileManager.default.fileExists(atPath: catalogPath) else {
            return .failure(.missingCatalogFile(catalogPath: catalogPath))
        }

        do {
            let catalogData = try Data(contentsOf: Self.catalogURL)
            let catalog = try JSONDecoder().decode(LiveSmokeXCStringsCatalog.self, from: catalogData)
            return .success(catalog)
        } catch {
            return .failure(
                .unreadableCatalogFile(
                    catalogPath: catalogPath,
                    underlyingError: error.localizedDescription
                )
            )
        }
    }
}

private struct LiveSmokeXCStringsCatalog: Decodable {
    let strings: [String: LiveSmokeXCStringsEntry]
}

private struct LiveSmokeXCStringsEntry: Decodable {
    let localizations: [String: LiveSmokeXCStringsLocalization]?
}

private struct LiveSmokeXCStringsLocalization: Decodable {
    let stringUnit: LiveSmokeXCStringsStringUnit?
}

private struct LiveSmokeXCStringsStringUnit: Decodable {
    let value: String
}

private enum LiveSmokeLocalizationCatalogError: LocalizedError {
    case missingCatalogFile(catalogPath: String)
    case unreadableCatalogFile(catalogPath: String, underlyingError: String)
    case missingKey(key: String, catalogPath: String)
    case missingLocalization(key: String, localization: String, catalogPath: String)
    case missingValue(key: String, localization: String, catalogPath: String)

    var errorDescription: String? {
        switch self {
        case .missingCatalogFile(let catalogPath):
            return "Missing Foundation.xcstrings catalog at \(catalogPath)."
        case .unreadableCatalogFile(let catalogPath, let underlyingError):
            return "Failed to load Foundation.xcstrings catalog at \(catalogPath): \(underlyingError)"
        case .missingKey(let key, let catalogPath):
            return "Missing localization key \(key) in Foundation.xcstrings catalog at \(catalogPath)."
        case .missingLocalization(let key, let localization, let catalogPath):
            return "Missing localization \(localization) for key \(key) in Foundation.xcstrings catalog at \(catalogPath)."
        case .missingValue(let key, let localization, let catalogPath):
            return "Missing localized value for key \(key) and localization \(localization) in Foundation.xcstrings catalog at \(catalogPath)."
        }
    }
}
