import Foundation

enum LiveSmokeIdentifier {
    static let cloudWorkspaceChooserScreen: String = "cloudSignIn.workspaceChooserScreen"
    static let cloudSignInScreen: String = "cloudSignIn.screen"
    static let cloudSignInInlineAuthError: String = "cloudSignIn.inlineAuthError"
    static let cloudSignInInlineAuthErrorMessage: String = "cloudSignIn.inlineAuthErrorMessage"
    static let cloudSignInPostAuthLoadingScreen: String = "cloudSignIn.postAuthLoading.screen"
    static let cloudSignInPostAuthSyncScreen: String = "cloudSignIn.postAuthSync.screen"
    static let cloudSignInPostAuthFailureScreen: String = "cloudSignIn.postAuthFailure.screen"
    static let cloudSignInPostAuthFailureMessage: String = "cloudSignIn.postAuthFailure.message"
    static let cloudSignInExistingWorkspacePrefix: String = "cloudSignIn.existingWorkspace."
    static let rootTabReviewItem: String = "rootTab.review.item"
    static let rootTabCardsItem: String = "rootTab.cards.item"
    static let rootTabAIItem: String = "rootTab.ai.item"
    static let rootTabSettingsItem: String = "rootTab.settings.item"
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
    static let aiConversationScrollSurface: String = "ai.conversationScrollSurface"
    static let aiMessageRow: String = "ai.messageRow"
    static let aiComposerTextField: String = "ai.composerTextField"
    static let aiComposerDismissKeyboardButton: String = "ai.composerDismissKeyboardButton"
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
    case localGuestSeededLongAIConversation = "local_guest_seeded_long_ai_conversation"
    case marketingOpportunityCostReviewCard = "marketing_opportunity_cost_review_card"
    case marketingConceptCards = "marketing_concept_cards"
}

struct LiveSmokeTabBarItemLookup {
    let identifier: String
    let localizedTitle: String
    let stableIndex: Int
}

enum LiveSmokeSelectedTab: String {
    case review
    case cards
    case ai
    case settings

    var itemIdentifier: String {
        switch self {
        case .review:
            return LiveSmokeIdentifier.rootTabReviewItem
        case .cards:
            return LiveSmokeIdentifier.rootTabCardsItem
        case .ai:
            return LiveSmokeIdentifier.rootTabAIItem
        case .settings:
            return LiveSmokeIdentifier.rootTabSettingsItem
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

    func tabBarItemLookup(localization: LiveSmokeLaunchLocalization) -> LiveSmokeTabBarItemLookup {
        LiveSmokeTabBarItemLookup(
            identifier: self.itemIdentifier,
            localizedTitle: self.localizedTitle(localization: localization),
            stableIndex: self.stableTabIndex
        )
    }

    var stableTabIndex: Int {
        switch self {
        case .review:
            return 0
        case .cards:
            return 1
        case .ai:
            return 2
        case .settings:
            return 3
        }
    }

    func localizedTitle(localization: LiveSmokeLaunchLocalization) -> String {
        switch (self, localization) {
        case (.review, .english):
            return "Review"
        case (.review, .arabic):
            return "المراجعة"
        case (.review, .chineseSimplified):
            return "复习"
        case (.review, .german):
            return "Wiederholen"
        case (.review, .hindi):
            return "समीक्षा"
        case (.review, .japanese):
            return "復習"
        case (.review, .russian):
            return "Повторение"
        case (.review, .spanishMexico):
            return "Repasar"
        case (.review, .spanishSpain):
            return "Repasar"
        case (.cards, .english):
            return "Cards"
        case (.cards, .arabic):
            return "البطاقات"
        case (.cards, .chineseSimplified):
            return "卡片"
        case (.cards, .german):
            return "Karten"
        case (.cards, .hindi):
            return "कार्ड"
        case (.cards, .japanese):
            return "カード"
        case (.cards, .russian):
            return "Карточки"
        case (.cards, .spanishMexico):
            return "Tarjetas"
        case (.cards, .spanishSpain):
            return "Tarjetas"
        case (.ai, .english):
            return "AI"
        case (.ai, .arabic):
            return "الذكاء الاصطناعي"
        case (.ai, .chineseSimplified):
            return "AI"
        case (.ai, .german):
            return "KI"
        case (.ai, .hindi):
            return "AI"
        case (.ai, .japanese):
            return "AI"
        case (.ai, .russian):
            return "ИИ"
        case (.ai, .spanishMexico):
            return "IA"
        case (.ai, .spanishSpain):
            return "IA"
        case (.settings, .english):
            return "Settings"
        case (.settings, .arabic):
            return "الإعدادات"
        case (.settings, .chineseSimplified):
            return "设置"
        case (.settings, .german):
            return "Einstellungen"
        case (.settings, .hindi):
            return "सेटिंग्स"
        case (.settings, .japanese):
            return "設定"
        case (.settings, .russian):
            return "Настройки"
        case (.settings, .spanishMexico):
            return "Ajustes"
        case (.settings, .spanishSpain):
            return "Ajustes"
        }
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
    case cloudSignIn
    case cloudWorkspaceChooser
    case cloudSignInPostAuthLoading
    case cloudSignInPostAuthSync
    case cloudSignInPostAuthFailure
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
        case .cloudSignIn:
            return LiveSmokeIdentifier.cloudSignInScreen
        case .cloudWorkspaceChooser:
            return LiveSmokeIdentifier.cloudWorkspaceChooserScreen
        case .cloudSignInPostAuthLoading:
            return LiveSmokeIdentifier.cloudSignInPostAuthLoadingScreen
        case .cloudSignInPostAuthSync:
            return LiveSmokeIdentifier.cloudSignInPostAuthSyncScreen
        case .cloudSignInPostAuthFailure:
            return LiveSmokeIdentifier.cloudSignInPostAuthFailureScreen
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
        case .cloudSignIn:
            return "Cloud Sign In"
        case .cloudWorkspaceChooser:
            return "Cloud Workspace Chooser"
        case .cloudSignInPostAuthLoading:
            return "Cloud Sign In Post-Auth Loading"
        case .cloudSignInPostAuthSync:
            return "Cloud Sign In Post-Auth Sync"
        case .cloudSignInPostAuthFailure:
            return "Cloud Sign In Post-Auth Failure"
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
