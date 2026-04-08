import XCTest

extension LiveSmokeTestCase {
    @MainActor
    func makeRunContext() -> LiveSmokeRunContext {
        let runToken = String(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(10))
        let workspaceToken = String(runToken.prefix(6))

        return LiveSmokeRunContext(
            workspaceName: "E2E iOS \(workspaceToken)",
            manualFrontText: "Manual \(runToken)",
            manualBackText: "Manual answer \(runToken)"
        )
    }

    @MainActor
    func runSignedInLinkedWorkspaceScenario(
        context: LiveSmokeRunContext,
        reviewEmail: String,
        scenario: () throws -> Void
    ) throws {
        try self.launchApplication(
            resetState: .localGuest,
            selectedTab: .settings
        )

        var primaryFailure: Error?
        var shouldDeleteWorkspace = false

        do {
            var didCreateWorkspaceInChooser = false
            try self.step("sign in with the configured review account") {
                didCreateWorkspaceInChooser = try self.signInWithReviewAccount(reviewEmail: reviewEmail)
            }

            if didCreateWorkspaceInChooser == false {
                try self.step("create an isolated workspace after auto-linking") {
                    try self.createWorkspaceFromCurrentWorkspaceSelection()
                }
            }

            shouldDeleteWorkspace = true

            try self.step("rename the linked workspace for this run") {
                try self.renameLinkedWorkspace(workspaceName: context.workspaceName)
            }

            try scenario()
        } catch {
            primaryFailure = error
        }

        if shouldDeleteWorkspace {
            if primaryFailure != nil {
                self.resetInlineRawScreenStateFailureGuard()
            }
            do {
                try self.step("delete the isolated workspace") {
                    try self.deleteEphemeralWorkspace()
                }
            } catch {
                if primaryFailure == nil {
                    throw error
                }

                let cleanupDiagnostics = self.makeTextAttachment(
                    name: "Cleanup Failure After Primary Failure",
                    text: """
                    Cleanup failed after primary failure.
                    Cleanup error: \(error.localizedDescription)
                    Current screen: \(self.currentScreenSummary())
                    Visible text snapshot: \(self.visibleTextSnapshot())
                    Breadcrumbs:
                    \(self.recentBreadcrumbLines())
                    """
                )
                self.add(cleanupDiagnostics)
                smokeLogger.error(
                    "event=cleanup_failure_after_primary step=\(self.currentStepTitle, privacy: .public) currentScreen=\(self.currentScreenSummary(), privacy: .public) error=\(error.localizedDescription, privacy: .public)"
                )
            }
        }

        if let primaryFailure {
            throw primaryFailure
        }
    }

    @MainActor
    func signInWithReviewAccount(reviewEmail: String) throws -> Bool {
        try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.openAccountStatus()

        let signInButton = self.app.buttons[LiveSmokeIdentifier.accountStatusSignInButton]
        if self.waitForOptionalElement(
            signInButton,
            identifier: LiveSmokeIdentifier.accountStatusSignInButton,
            timeout: LiveSmokeConfiguration.optionalProbeTimeoutSeconds
        ) {
            try self.tapButton(
                identifier: LiveSmokeIdentifier.accountStatusSignInButton,
                timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
            )
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.cloudSignInScreen,
                timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
            )
            try self.typeTextSafely(
                reviewEmail,
                intoElementWithIdentifier: LiveSmokeIdentifier.cloudSignInEmailField,
                timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
            )
            try self.tapButton(
                identifier: LiveSmokeIdentifier.cloudSignInSendCodeButton,
                timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
            )
            let didUseWorkspaceChooser = try self.completeCloudWorkspaceSelectionIfNeeded()
            try self.assertLinkedEmailVisible(reviewEmail: reviewEmail, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
            try self.tapFirstNavigationBackButton()
            try self.tapFirstNavigationBackButton()
            return didUseWorkspaceChooser
        } else if self.isAccountStatusLinked() {
            let visibleEmail = self.visibleLinkedEmailLabel()
            if visibleEmail?.contains(reviewEmail) == false {
                throw LiveSmokeFailure.unexpectedAccountState(
                    message: "Expected linked review email containing '\(reviewEmail)', but found '\(visibleEmail ?? "unknown")'.",
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }
            try self.assertLinkedEmailVisible(reviewEmail: reviewEmail, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
            try self.tapFirstNavigationBackButton()
            try self.tapFirstNavigationBackButton()
            return false
        } else {
            throw LiveSmokeFailure.unexpectedAccountState(
                message: "Expected sign-in or linked account state, but neither was visible.",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    func createWorkspaceFromCurrentWorkspaceSelection() throws {
        try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButtonScrollingIntoView(
            identifier: LiveSmokeIdentifier.settingsCurrentWorkspaceRow,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .currentWorkspace, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButton(
            identifier: LiveSmokeIdentifier.currentWorkspaceRowButton,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )
        try self.assertCurrentWorkspacePickerIsVisible()
        try self.tapButtonScrollingIntoView(
            identifier: LiveSmokeIdentifier.currentWorkspaceCreateButton,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .currentWorkspace, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.tapFirstNavigationBackButton()
        try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
    }

    @MainActor
    func renameLinkedWorkspace(workspaceName: String) throws {
        try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButton(
            identifier: LiveSmokeIdentifier.settingsWorkspaceSettingsRow,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .workspaceSettings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButton(
            identifier: LiveSmokeIdentifier.workspaceSettingsOverviewRow,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .workspaceOverview, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.replaceTextSafely(
            workspaceName,
            inElementWithIdentifier: LiveSmokeIdentifier.workspaceOverviewNameField,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )
        try self.tapButton(
            identifier: LiveSmokeIdentifier.workspaceOverviewSaveNameButton,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.tapFirstNavigationBackButton()
        try self.tapFirstNavigationBackButton()
        try self.assertTextExists(workspaceName, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
    }

    @MainActor
    func deleteEphemeralWorkspace() throws {
        self.logSmokeBreadcrumb(
            event: "cleanup_start",
            action: "delete_workspace",
            identifier: "-",
            timeoutSeconds: "-",
            durationSeconds: "-",
            result: "start",
            note: "cleanup begins"
        )
        _ = self.dismissKnownBlockingAlertIfVisible()
        try self.openWorkspaceOverviewFromSettings()
        try self.tapButtonPreservingAlerts(
            identifier: LiveSmokeIdentifier.workspaceOverviewDeleteWorkspaceButton,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )

        try self.tapAlertButtonPreservingAlerts(label: "Continue", timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)

        let confirmationPhrase = self.app.staticTexts[LiveSmokeIdentifier.deleteWorkspaceConfirmationPhrase]
        if self.waitForOptionalElement(
            confirmationPhrase,
            identifier: LiveSmokeIdentifier.deleteWorkspaceConfirmationPhrase,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        ) == false {
            throw LiveSmokeFailure.missingElement(
                identifier: LiveSmokeIdentifier.deleteWorkspaceConfirmationPhrase,
                timeoutSeconds: LiveSmokeConfiguration.longUiTimeoutSeconds,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        try self.replaceTextSafely(
            confirmationPhrase.label,
            inElementWithIdentifier: LiveSmokeIdentifier.deleteWorkspaceConfirmationField,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )
        try self.tapButton(
            identifier: LiveSmokeIdentifier.deleteWorkspaceConfirmationButton,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        self.logSmokeBreadcrumb(
            event: "cleanup_end",
            action: "delete_workspace",
            identifier: LiveSmokeIdentifier.deleteWorkspaceConfirmationButton,
            timeoutSeconds: formatDuration(seconds: LiveSmokeConfiguration.longUiTimeoutSeconds),
            durationSeconds: "-",
            result: "success",
            note: "cleanup finished"
        )
    }

    @MainActor
    func openWorkspaceResetProgressFlow() throws {
        try self.tapTabBarItem(named: LiveSmokeScreen.settings.title, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButton(
            identifier: LiveSmokeIdentifier.settingsWorkspaceSettingsRow,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .workspaceSettings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButtonPreservingAlerts(
            identifier: LiveSmokeIdentifier.workspaceSettingsResetProgressButton,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.tapAlertButtonPreservingAlerts(label: "Continue", timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.resetWorkspaceProgressConfirmationPhrase,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )
    }

    @MainActor
    func loadWorkspaceResetProgressConfirmationPhrase() throws -> String {
        let phraseElement = self.app.staticTexts[LiveSmokeIdentifier.resetWorkspaceProgressConfirmationPhrase].firstMatch
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.resetWorkspaceProgressConfirmationPhrase,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )

        let confirmationPhrase = phraseElement.label.trimmingCharacters(in: .whitespacesAndNewlines)
        if confirmationPhrase.isEmpty {
            throw LiveSmokeFailure.missingText(
                text: "reset all progress for all cards in this workspace",
                timeoutSeconds: LiveSmokeConfiguration.shortUiTimeoutSeconds,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        return confirmationPhrase
    }

    @MainActor
    func confirmWorkspaceResetProgressPreview(expectedCardsToResetCount: Int) throws {
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.resetWorkspaceProgressCardsCount,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertElementLabel(
            identifier: LiveSmokeIdentifier.resetWorkspaceProgressCardsCount,
            expectedLabel: String(expectedCardsToResetCount),
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
    }

    @MainActor
    func openWorkspaceOverviewFromWorkspaceSettings() throws {
        try self.assertScreenVisible(screen: .workspaceSettings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButtonScrollingIntoView(
            identifier: LiveSmokeIdentifier.workspaceSettingsOverviewRow,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .workspaceOverview, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
    }

    @MainActor
    func openAccountStatus() throws {
        try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButtonScrollingIntoView(
            identifier: LiveSmokeIdentifier.settingsAccountSettingsRow,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .accountSettings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButtonScrollingIntoView(
            identifier: LiveSmokeIdentifier.accountSettingsAccountStatusRow,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .accountStatus, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
    }

    @MainActor
    func openAccountDangerZone() throws {
        try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButtonScrollingIntoView(
            identifier: LiveSmokeIdentifier.settingsAccountSettingsRow,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .accountSettings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButtonScrollingIntoView(
            identifier: LiveSmokeIdentifier.accountSettingsDangerZoneRow,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .dangerZone, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
    }

    @MainActor
    func openWorkspaceOverviewFromSettings() throws {
        try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButtonScrollingIntoView(
            identifier: LiveSmokeIdentifier.settingsWorkspaceSettingsRow,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .workspaceSettings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButtonScrollingIntoView(
            identifier: LiveSmokeIdentifier.workspaceSettingsOverviewRow,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .workspaceOverview, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
    }

    @MainActor
    func logoutFromAccountStatus() throws {
        try self.tapButton(
            identifier: LiveSmokeIdentifier.accountStatusLogoutButton,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )
        try self.tapAlertButton(label: "Log out", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
    }

    @MainActor
    func completeCloudWorkspaceSelectionIfNeeded() throws -> Bool {
        let deadline = Date().addingTimeInterval(LiveSmokeConfiguration.longUiTimeoutSeconds * 3)
        var didUseWorkspaceChooser = false

        while Date() < deadline {
            _ = self.dismissKnownBlockingAlertIfVisible()

            if self.isAccountStatusLinked() {
                return didUseWorkspaceChooser
            }

            let chooserScreen = self.app.descendants(matching: .any)
                .matching(identifier: LiveSmokeIdentifier.cloudWorkspaceChooserScreen)
                .firstMatch
            let chooserVisible = chooserScreen.exists

            if chooserVisible {
                if try self.tryCreateWorkspaceInChooser() {
                    didUseWorkspaceChooser = true
                } else {
                    try self.tapFirstExistingWorkspaceButtonInChooser()
                }
                continue
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }

        throw LiveSmokeFailure.unexpectedAccountState(
            message: "Timed out waiting for linked account state after post-auth workspace selection.",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    func scrollWorkspaceChooserToCreateWorkspaceButton() throws {
        let chooserList = self.app.collectionViews[LiveSmokeIdentifier.cloudWorkspaceChooserScreen].firstMatch
        let createButton = self.app.buttons[LiveSmokeIdentifier.cloudSignInCreateWorkspaceButton].firstMatch
        let deadline = Date().addingTimeInterval(LiveSmokeConfiguration.longUiTimeoutSeconds)

        while Date() < deadline {
            if createButton.exists && createButton.isHittable {
                return
            }

            if chooserList.exists {
                chooserList.swipeUp()
            } else {
                self.app.swipeUp()
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
        }

        throw LiveSmokeFailure.missingElement(
            identifier: LiveSmokeIdentifier.cloudSignInCreateWorkspaceButton,
            timeoutSeconds: LiveSmokeConfiguration.longUiTimeoutSeconds,
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    func tryCreateWorkspaceInChooser() throws -> Bool {
        do {
            try self.scrollWorkspaceChooserToCreateWorkspaceButton()
            try self.tapButton(
                identifier: LiveSmokeIdentifier.cloudSignInCreateWorkspaceButton,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            return true
        } catch {
            return false
        }
    }

    @MainActor
    func tapFirstExistingWorkspaceButtonInChooser() throws {
        let chooserList = self.app.collectionViews[LiveSmokeIdentifier.cloudWorkspaceChooserScreen].firstMatch
        let existingWorkspaceButton = chooserList.buttons
            .matching(NSPredicate(format: "identifier BEGINSWITH %@", "cloudSignIn.existingWorkspace."))
            .firstMatch

        if existingWorkspaceButton.exists == false {
            throw LiveSmokeFailure.missingElement(
                identifier: "cloudSignIn.existingWorkspace.*",
                timeoutSeconds: LiveSmokeConfiguration.shortUiTimeoutSeconds,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        let identifier = existingWorkspaceButton.identifier
        if identifier.isEmpty {
            throw LiveSmokeFailure.missingElement(
                identifier: "cloudSignIn.existingWorkspace.*",
                timeoutSeconds: LiveSmokeConfiguration.shortUiTimeoutSeconds,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        try self.tapButton(
            identifier: identifier,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )
    }

    @MainActor
    func isAccountStatusLinked() -> Bool {
        let syncNowButton = self.app.buttons[LiveSmokeIdentifier.accountStatusSyncNowButton]
        return syncNowButton.exists
    }

    @MainActor
    func visibleLinkedEmailLabel() -> String? {
        let linkedEmailLabel = self.app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "@")).firstMatch
        if self.waitForOptionalElement(
            linkedEmailLabel,
            identifier: "text.linkedEmail",
            timeout: LiveSmokeConfiguration.optionalProbeTimeoutSeconds
        ) {
            return linkedEmailLabel.label
        }

        return nil
    }

    @MainActor
    func assertLinkedEmailVisible(reviewEmail: String, timeout: TimeInterval) throws {
        let startedAt = Date()
        let deadline = startedAt.addingTimeInterval(timeout)

        while Date() < deadline {
            _ = self.dismissKnownBlockingAlertIfVisible()
            if let visibleEmail = self.visibleLinkedEmailLabel(), visibleEmail.contains(reviewEmail) {
                return
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }

        try self.assertTextExists(reviewEmail, timeout: LiveSmokeConfiguration.optionalProbeTimeoutSeconds)
    }
}
