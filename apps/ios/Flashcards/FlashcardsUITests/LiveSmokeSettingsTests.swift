import Foundation
import XCTest

final class LiveSmokeSettingsTests: LiveSmokeTestCase {
    @MainActor
    func testLiveSmokeGuestPremiumSheetCanReopen() throws {
        try self.step("prepare guest subscription settings") {
            try self.launchApplication(launchScenario: .guestEmptyWorkspace, selectedTab: .settings)
            try self.openSettingsRootRow(identifier: LiveSmokeIdentifier.settingsSubscriptionRow)
            try self.assertElementEnabled(
                identifier: LiveSmokeIdentifier.subscriptionSettingsPremiumButton,
                timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
            )
        }

        for presentationNumber in 1...2 {
            try self.step("open and dismiss the premium sheet \(presentationNumber)") {
                try self.tapButton(
                    identifier: LiveSmokeIdentifier.subscriptionSettingsPremiumButton,
                    timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
                )
                try self.assertElementExists(
                    identifier: LiveSmokeIdentifier.premiumOfferSheet,
                    timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
                )
                try self.tapButtonScrollingIntoView(
                    identifier: LiveSmokeIdentifier.premiumContinueFreeButton,
                    timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
                )
                try self.assertElementDoesNotExist(
                    identifier: LiveSmokeIdentifier.premiumOfferSheet,
                    timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
                )
            }
        }
    }

    @MainActor
    func testLiveSmokeGuestNavigationFlow() throws {
        try self.step("verify guest navigation surfaces without login") {
            try self.launchApplication(launchScenario: .guestEmptyWorkspace, selectedTab: .cards)
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.cardsAddButton,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )

            try self.tapTabBarItem(selectedTab: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertScreenVisible(screen: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)

            try self.tapTabBarItem(selectedTab: .progress, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertScreenVisible(screen: .progress, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)

            try self.tapTabBarItem(selectedTab: .ai, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertAiEntrySurfaceVisible()

            try self.tapTabBarItem(selectedTab: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.verifySettingsInformationArchitecture()
            try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
    }

    @MainActor
    private func verifySettingsInformationArchitecture() throws {
        try self.assertTextExists("Feedback", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.settingsReviewInAppStoreRow,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.settingsPrivateFeedbackRow,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )

        try self.assertSettingsRootTextExistsScrollingIntoView("Account", timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.openSettingsRootRow(identifier: LiveSmokeIdentifier.settingsAccountStatusRow)
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.accountStatusSignInButton,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.returnToSettingsRoot()

        try self.openSettingsRootRow(identifier: LiveSmokeIdentifier.settingsCurrentWorkspaceRow)
        try self.assertScreenVisible(screen: .currentWorkspace, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.returnToSettingsRoot()

        try self.assertSettingsRootTextExistsScrollingIntoView("Style", timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertSettingsRowOrder(
            identifiers: [
                LiveSmokeIdentifier.settingsReviewAnimationsRow,
                LiveSmokeIdentifier.settingsAIChatSuggestionsRow
            ],
            message: "Style settings rows should appear as Review Animations, then AI Chat Suggestions."
        )
        try self.openSettingsRootRow(identifier: LiveSmokeIdentifier.settingsReviewAnimationsRow)
        try self.assertScreenVisible(screen: .reviewAnimationsSettings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.returnToSettingsRoot()

        try self.openSettingsRootRow(identifier: LiveSmokeIdentifier.settingsAIChatSuggestionsRow)
        try self.assertScreenVisible(screen: .aiChatSuggestionsSettings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.returnToSettingsRoot()

        try self.assertSettingsRootTextExistsScrollingIntoView("General", timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.openSettingsRootRow(identifier: LiveSmokeIdentifier.settingsReviewRemindersRow)
        try self.assertTextExistsScrollingIntoView("Permission", timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.returnToSettingsRoot()

        try self.assertSettingsRowOrder(
            identifiers: [
                LiveSmokeIdentifier.settingsReviewRemindersRow,
                LiveSmokeIdentifier.settingsLeaderboardParticipationRow,
                LiveSmokeIdentifier.settingsLanguageRow
            ],
            message: "General settings rows should appear as Notifications, Leaderboard participation, then Language."
        )
        try self.openSettingsRootRow(identifier: LiveSmokeIdentifier.settingsLeaderboardParticipationRow)
        try self.assertScreenVisible(screen: .leaderboardParticipationSettings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.returnToSettingsRoot()

        try self.openSettingsRootRow(identifier: LiveSmokeIdentifier.settingsLanguageRow)
        try self.assertScreenVisible(screen: .languageSettings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.languageSettingsSystemText,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )
        try self.assertLanguageTextExistsScrollingIntoView("English", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertLanguageTextExistsScrollingIntoView("Spanish Spain", timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.returnToSettingsRoot()

        try self.openSettingsRootRow(identifier: LiveSmokeIdentifier.settingsAccessRow)
        try self.assertTextExists("Permissions", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.returnToSettingsRoot()

        try self.assertSettingsRootElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.settingsDecksRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertSettingsRootElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.settingsTagsRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertSettingsRootElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.settingsExportRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)

        try self.assertSettingsRootTextExistsScrollingIntoView("Support", timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertSettingsRootElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.settingsFeedbackRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertSettingsRootElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.settingsSupportRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertSettingsRootElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.settingsLegalRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertSettingsRootElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.settingsOpenSourceRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)

        try self.assertSettingsRootTextExistsScrollingIntoView("Advanced", timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.openSettingsRootRow(identifier: LiveSmokeIdentifier.settingsSchedulingRow)
        try self.assertTextExists("Scheduler", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.returnToSettingsRoot()

        try self.assertSettingsRootElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.settingsAgentConnectionsRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)

        try self.openSettingsRootRow(identifier: LiveSmokeIdentifier.settingsServerRow)
        try self.assertTextExists("Current Server", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.returnToSettingsRoot()

        try self.openSettingsRootRow(identifier: LiveSmokeIdentifier.settingsDeviceDiagnosticsRow)
        try self.assertTextExists("Operating system", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.returnToSettingsRoot()

        try self.assertSettingsRootElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.settingsResetStudyProgressRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertSettingsRootElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.settingsDeleteCurrentWorkspaceRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)

        try self.openSettingsRootRow(identifier: LiveSmokeIdentifier.settingsDeleteAccountRow)
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.dangerZoneDeleteAccountButton,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.returnToSettingsRoot()

        if self.app.buttons[LiveSmokeIdentifier.settingsTestRow].firstMatch.exists {
            throw LiveSmokeFailure.unexpectedAccountState(
                message: "Test settings row should be hidden when test mode is off.",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    private func openSettingsRootRow(identifier: String) throws {
        try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapSettingsButtonScrollingIntoView(
            identifier: identifier,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
    }

    @MainActor
    private func assertLanguageTextExistsScrollingIntoView(_ text: String, timeout: TimeInterval) throws {
        #if targetEnvironment(macCatalyst)
        try self.runWithInlineRawScreenStateOnFailure(action: "assert_text_exists_scrolling.\(text)") {
            let languageList = self.app.collectionViews[LiveSmokeIdentifier.languageSettingsScreen].firstMatch
            guard languageList.exists else {
                throw LiveSmokeFailure.missingElement(
                    identifier: LiveSmokeIdentifier.languageSettingsScreen,
                    timeoutSeconds: timeout,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }

            let predicate = NSPredicate(format: "label == %@ OR identifier == %@", text, text)
            let textElement = languageList.descendants(matching: .any).matching(predicate).firstMatch
            let deadline = Date().addingTimeInterval(timeout)

            while Date() < deadline {
                if textElement.exists {
                    return
                }

                languageList.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.5))
                    .scroll(byDeltaX: 0, deltaY: -120)
                RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
            }

            throw LiveSmokeFailure.missingText(
                text: text,
                timeoutSeconds: timeout,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
        #else
        try self.assertTextExistsScrollingIntoView(text, timeout: timeout)
        #endif
    }

    @MainActor
    private func assertSettingsRootTextExistsScrollingIntoView(_ text: String, timeout: TimeInterval) throws {
        #if targetEnvironment(macCatalyst)
        try self.runWithInlineRawScreenStateOnFailure(action: "assert_text_exists_scrolling.\(text)") {
            let settingsList = self.app.collectionViews[LiveSmokeIdentifier.settingsScreen].firstMatch
            let predicate = NSPredicate(format: "label == %@ OR identifier == %@", text, text)
            let textElement = settingsList.descendants(matching: .any).matching(predicate).firstMatch
            let deadline = Date().addingTimeInterval(timeout)

            while Date() < deadline {
                if textElement.exists {
                    return
                }

                try self.scrollSettingsRootContent(timeout: timeout)
                RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
            }

            throw LiveSmokeFailure.missingText(
                text: text,
                timeoutSeconds: timeout,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
        #else
        try self.assertTextExistsScrollingIntoView(text, timeout: timeout)
        #endif
    }

    @MainActor
    private func assertSettingsRootElementExistsScrollingIntoView(identifier: String, timeout: TimeInterval) throws {
        #if targetEnvironment(macCatalyst)
        try self.runWithInlineRawScreenStateOnFailure(action: "assert_element_exists_scrolling.\(identifier)") {
            let settingsList = self.app.collectionViews[LiveSmokeIdentifier.settingsScreen].firstMatch
            let element = settingsList.descendants(matching: .any).matching(identifier: identifier).firstMatch
            let deadline = Date().addingTimeInterval(timeout)

            while Date() < deadline {
                if element.exists {
                    return
                }

                try self.scrollSettingsRootContent(timeout: timeout)
                RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
            }

            throw LiveSmokeFailure.missingElement(
                identifier: identifier,
                timeoutSeconds: timeout,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
        #else
        try self.assertElementExistsScrollingIntoView(identifier: identifier, timeout: timeout)
        #endif
    }

    @MainActor
    private func assertSettingsRowOrder(identifiers: [String], message: String) throws {
        for identifier in identifiers {
            try self.assertSettingsRootElementExistsScrollingIntoView(
                identifier: identifier,
                timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
            )
        }

        let rowMinYs = identifiers.map { identifier in
            self.app.buttons[identifier].firstMatch.frame.minY
        }
        if zip(rowMinYs, rowMinYs.dropFirst()).allSatisfy({ upper, lower in upper < lower }) {
            return
        }

        throw LiveSmokeFailure.unexpectedAccountState(
            message: message,
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    private func returnToSettingsRoot() throws {
        try self.tapFirstNavigationBackButton()
        try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
    }

    @MainActor
    func testLiveSmokeResetWorkspaceProgressFlow() throws {
        let context = self.makeRunContext()
        let reviewEmail = try self.configuredReviewEmail()

        try self.runSignedInLinkedWorkspaceScenario(context: context, reviewEmail: reviewEmail) {
            try self.step("create one manual card in the linked workspace") {
                try self.tapTabBarItem(selectedTab: .cards, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.createManualCard(frontText: context.manualFrontText, backText: context.manualBackText)
            }

            try self.step("review the manual card once") {
                try self.tapTabBarItem(selectedTab: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.reviewCurrentCard(expectedFrontText: context.manualFrontText)
            }

            try self.step("reset workspace progress and verify the preview count") {
                try self.openWorkspaceResetProgressFlow()
                let confirmationPhrase = try self.loadWorkspaceResetProgressConfirmationPhrase()
                try self.replaceTextSafely(
                    confirmationPhrase,
                    inElementWithIdentifier: LiveSmokeIdentifier.resetWorkspaceProgressConfirmationField,
                    timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
                )
                try self.tapButton(
                    identifier: LiveSmokeIdentifier.resetWorkspaceProgressContinueButton,
                    timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
                )
                try self.confirmWorkspaceResetProgressPreview(expectedCardsToResetCount: 1)
                try self.tapButton(
                    identifier: LiveSmokeIdentifier.resetWorkspaceProgressButton,
                    timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
                )
                try self.assertElementDoesNotExist(
                    identifier: LiveSmokeIdentifier.resetWorkspaceProgressButton,
                    timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
                )
                try self.assertScreenVisible(screen: .resetStudyProgress, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
                try self.tapFirstNavigationBackButton()
                try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            }

            try self.step("verify the reset card is reviewable again") {
                try self.tapTabBarItem(selectedTab: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.reviewCurrentCard(expectedFrontText: context.manualFrontText)
                try self.tapTabBarItem(selectedTab: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            }
        }
    }

    @MainActor
    func testLiveSmokeNotificationTapColdStartOpensReviewOnce() throws {
        try self.step("verify notification tap cold start opens review once") {
            try self.launchApplicationWithAppNotificationTap(
                launchScenario: .guestManualReviewCard,
                selectedTab: .cards,
                appNotificationTapType: .reviewReminder
            )
            try self.assertScreenVisible(screen: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)

            try self.tapTabBarItem(selectedTab: .cards, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertScreenVisible(screen: .cards, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)

            #if targetEnvironment(macCatalyst)
            self.app.typeKey("h", modifierFlags: .command)
            #else
            XCUIDevice.shared.press(.home)
            #endif
            self.app.activate()
            try self.waitForApplicationToReachForeground(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertScreenVisible(screen: .cards, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
    }

    @MainActor
    func testLiveSmokeUnsupportedNotificationTapDoesNotNavigate() throws {
        try self.step("verify unsupported notification tap stays on selected tab") {
            try self.launchApplicationWithAppNotificationTap(
                launchScenario: .guestEmptyWorkspace,
                selectedTab: .cards,
                appNotificationTapType: .unsupported
            )
            try self.waitForSelectedTabScreen(selectedTab: .cards, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
    }

    // Real SpringBoard local-notification tap smoke is intentionally omitted here.
    // On the iOS 26.4 simulator, XCTest reaches Notification Center but the system
    // routes the tap into a side-swipe hint instead of executing the default action.

    @MainActor
    func testLiveSmokeLoginAndLinkedWorkspaceFlow() throws {
        let context = self.makeRunContext()
        let reviewEmail = try self.configuredReviewEmail()

        try self.runSignedInLinkedWorkspaceScenario(context: context, reviewEmail: reviewEmail) {
            try self.step("verify linked account status and workspace state") {
                try self.assertTextExists(context.workspaceName, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
                try self.openAccountStatus()
                try self.assertLinkedEmailVisible(reviewEmail: reviewEmail, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
                try self.assertElementExists(
                    identifier: LiveSmokeIdentifier.accountStatusSyncNowButton,
                    timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
                )
                try self.tapFirstNavigationBackButton()
                try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            }

            try self.step("relaunch the app and keep the linked workspace and session") {
                self.app.terminate()
                try self.launchApplication(launchScenario: nil, selectedTab: .settings)
                try self.assertTextExists(context.workspaceName, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
                try self.openAccountStatus()
                try self.assertLinkedEmailVisible(reviewEmail: reviewEmail, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
                try self.assertElementExists(
                    identifier: LiveSmokeIdentifier.accountStatusSyncNowButton,
                    timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
                )
                try self.tapFirstNavigationBackButton()
                try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            }
        }
    }

    @MainActor
    private func configuredReviewEmail() throws -> String {
        guard let reviewEmail = ProcessInfo.processInfo.environment[LiveSmokeConfiguration.reviewEmailEnvironmentKey]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              reviewEmail.isEmpty == false else {
            throw LiveSmokeFailure.unexpectedAccountState(
                message: "Missing required environment variable \(LiveSmokeConfiguration.reviewEmailEnvironmentKey) for linked-workspace smoke.",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        return reviewEmail
    }
}
