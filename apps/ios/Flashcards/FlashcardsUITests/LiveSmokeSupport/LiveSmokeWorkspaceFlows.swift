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
        try self.launchApplication(resetState: .localGuest, selectedTab: .settings)

        var primaryFailure: Error?
        var shouldDeleteWorkspace = false

        do {
            try self.step("sign in with the configured review account") {
                try self.signInWithReviewAccount(reviewEmail: reviewEmail)
            }

            try self.step("create an isolated linked workspace for this run") {
                try self.createEphemeralWorkspace(workspaceName: context.workspaceName)
                shouldDeleteWorkspace = true
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
    func signInWithReviewAccount(reviewEmail: String) throws {
        try self.assertScreenVisible(screen: .settings, timeout: self.shortUiTimeoutSeconds)
        try self.openAccountStatus()

        let signInButton = self.app.buttons[LiveSmokeIdentifier.accountStatusSignInButton]
        if self.waitForOptionalElement(
            signInButton,
            identifier: LiveSmokeIdentifier.accountStatusSignInButton,
            timeout: self.optionalProbeTimeoutSeconds
        ) {
            self.logActionStart(action: "tap_element", identifier: LiveSmokeIdentifier.accountStatusSignInButton)
            signInButton.tap()
            _ = self.dismissKnownBlockingAlertIfVisible()
            self.logActionEnd(action: "tap_element", identifier: LiveSmokeIdentifier.accountStatusSignInButton, result: "success", note: "sign in tapped")
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.cloudSignInScreen,
                timeout: self.longUiTimeoutSeconds
            )
            try self.typeTextSafely(
                reviewEmail,
                intoElementWithIdentifier: LiveSmokeIdentifier.cloudSignInEmailField,
                timeout: self.longUiTimeoutSeconds
            )
            try self.tapElement(
                identifier: LiveSmokeIdentifier.cloudSignInSendCodeButton,
                timeout: self.longUiTimeoutSeconds
            )
            try self.completeCloudWorkspaceSelectionIfNeeded()
        } else if self.isAccountStatusLinked() {
            let visibleEmail = self.visibleLinkedEmailLabel()
            if visibleEmail?.contains(reviewEmail) == false {
                throw LiveSmokeFailure.unexpectedAccountState(
                    message: "Expected linked review email containing '\(reviewEmail)', but found '\(visibleEmail ?? "unknown")'.",
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }
        }

        try self.assertLinkedEmailVisible(reviewEmail: reviewEmail, timeout: self.longUiTimeoutSeconds)
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.accountStatusSyncNowButton,
            timeout: self.longUiTimeoutSeconds
        )
        try self.tapFirstNavigationBackButton()
        try self.tapFirstNavigationBackButton()
    }

    @MainActor
    func createEphemeralWorkspace(workspaceName: String) throws {
        try self.assertScreenVisible(screen: .settings, timeout: self.shortUiTimeoutSeconds)
        try self.tapElement(
            identifier: LiveSmokeIdentifier.settingsCurrentWorkspaceRow,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .currentWorkspace, timeout: self.shortUiTimeoutSeconds)
        try self.tapElement(
            identifier: LiveSmokeIdentifier.currentWorkspaceRowButton,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.assertCurrentWorkspacePickerIsVisible()
        try self.tapElement(
            identifier: LiveSmokeIdentifier.currentWorkspaceCreateButton,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.tapFirstNavigationBackButton()

        try self.tapElement(
            identifier: LiveSmokeIdentifier.settingsWorkspaceSettingsRow,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .workspaceSettings, timeout: self.shortUiTimeoutSeconds)
        try self.tapElement(
            identifier: LiveSmokeIdentifier.workspaceSettingsOverviewRow,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .workspaceOverview, timeout: self.shortUiTimeoutSeconds)
        try self.replaceTextSafely(
            workspaceName,
            inElementWithIdentifier: LiveSmokeIdentifier.workspaceOverviewNameField,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.tapElement(
            identifier: LiveSmokeIdentifier.workspaceOverviewSaveNameButton,
            timeout: self.longUiTimeoutSeconds
        )
        try self.tapFirstNavigationBackButton()
        try self.tapFirstNavigationBackButton()
        try self.assertTextExists(workspaceName, timeout: self.longUiTimeoutSeconds)
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
        try self.tapElement(
            identifier: LiveSmokeIdentifier.workspaceOverviewDeleteWorkspaceButton,
            timeout: self.shortUiTimeoutSeconds
        )

        let continueButton = self.app.alerts.buttons["Continue"]
        if self.waitForOptionalElement(
            continueButton,
            identifier: "alert.continueButton",
            timeout: self.longUiTimeoutSeconds
        ) == false {
            throw LiveSmokeFailure.missingElement(
                identifier: "alert.continueButton",
                timeoutSeconds: self.longUiTimeoutSeconds,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
        self.logActionStart(action: "tap_element", identifier: "alert.continueButton")
        continueButton.tap()
        self.logActionEnd(action: "tap_element", identifier: "alert.continueButton", result: "success", note: "continue alert tapped")

        let confirmationPhrase = self.app.staticTexts[LiveSmokeIdentifier.deleteWorkspaceConfirmationPhrase]
        if self.waitForOptionalElement(
            confirmationPhrase,
            identifier: LiveSmokeIdentifier.deleteWorkspaceConfirmationPhrase,
            timeout: self.longUiTimeoutSeconds
        ) == false {
            throw LiveSmokeFailure.missingElement(
                identifier: LiveSmokeIdentifier.deleteWorkspaceConfirmationPhrase,
                timeoutSeconds: self.longUiTimeoutSeconds,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        try self.replaceTextSafely(
            confirmationPhrase.label,
            inElementWithIdentifier: LiveSmokeIdentifier.deleteWorkspaceConfirmationField,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.tapElement(identifier: LiveSmokeIdentifier.deleteWorkspaceConfirmationButton, timeout: self.longUiTimeoutSeconds)
        self.logSmokeBreadcrumb(
            event: "cleanup_end",
            action: "delete_workspace",
            identifier: LiveSmokeIdentifier.deleteWorkspaceConfirmationButton,
            timeoutSeconds: formatDuration(seconds: self.longUiTimeoutSeconds),
            durationSeconds: "-",
            result: "success",
            note: "cleanup finished"
        )
    }

    @MainActor
    func openAccountStatus() throws {
        try self.assertScreenVisible(screen: .settings, timeout: self.shortUiTimeoutSeconds)
        try self.tapElement(
            identifier: LiveSmokeIdentifier.settingsAccountSettingsRow,
            timeout: self.longUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .accountSettings, timeout: self.shortUiTimeoutSeconds)
        try self.tapElement(
            identifier: LiveSmokeIdentifier.accountSettingsAccountStatusRow,
            timeout: self.longUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .accountStatus, timeout: self.shortUiTimeoutSeconds)
    }

    @MainActor
    func openWorkspaceOverviewFromSettings() throws {
        try self.assertScreenVisible(screen: .settings, timeout: self.shortUiTimeoutSeconds)
        try self.tapElement(
            identifier: LiveSmokeIdentifier.settingsWorkspaceSettingsRow,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .workspaceSettings, timeout: self.shortUiTimeoutSeconds)
        try self.tapElement(
            identifier: LiveSmokeIdentifier.workspaceSettingsOverviewRow,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .workspaceOverview, timeout: self.shortUiTimeoutSeconds)
    }

    @MainActor
    func logoutFromAccountStatus() throws {
        try self.tapElement(
            identifier: LiveSmokeIdentifier.accountStatusLogoutButton,
            timeout: self.shortUiTimeoutSeconds
        )

        let confirmationButton = self.app.alerts.buttons["Log out"]
        if self.waitForOptionalElement(
            confirmationButton,
            identifier: "alert.logoutButton",
            timeout: self.shortUiTimeoutSeconds
        ) == false {
            throw LiveSmokeFailure.missingElement(
                identifier: "alert.logoutButton",
                timeoutSeconds: self.shortUiTimeoutSeconds,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
        if confirmationButton.isEnabled == false {
            throw LiveSmokeFailure.disabledElement(
                identifier: "alert.logoutButton",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        self.logActionStart(action: "tap_element", identifier: "alert.logoutButton")
        confirmationButton.tap()
        _ = self.dismissKnownBlockingAlertIfVisible()
        self.logActionEnd(action: "tap_element", identifier: "alert.logoutButton", result: "success", note: "logout confirmed")
    }

    @MainActor
    func completeCloudWorkspaceSelectionIfNeeded() throws {
        let deadline = Date().addingTimeInterval(self.longUiTimeoutSeconds)
        let existingWorkspacePredicate = NSPredicate(
            format: "identifier BEGINSWITH %@",
            "cloudSignIn.existingWorkspace."
        )

        while Date() < deadline {
            _ = self.dismissKnownBlockingAlertIfVisible()

            if self.isAccountStatusLinked() {
                return
            }

            let chooserScreen = self.app.descendants(matching: .any)
                .matching(identifier: LiveSmokeIdentifier.cloudWorkspaceChooserScreen)
                .firstMatch
            let chooserVisible = self.waitForOptionalElement(
                chooserScreen,
                identifier: LiveSmokeIdentifier.cloudWorkspaceChooserScreen,
                timeout: self.optionalProbeTimeoutSeconds
            )

            if chooserVisible {
                let existingWorkspaceButton = self.app.buttons.matching(existingWorkspacePredicate).firstMatch
                if self.waitForOptionalElement(
                    existingWorkspaceButton,
                    identifier: "cloudSignIn.existingWorkspace.first",
                    timeout: self.optionalProbeTimeoutSeconds
                ) && existingWorkspaceButton.isEnabled {
                    self.logActionStart(action: "tap_element", identifier: "cloudSignIn.existingWorkspace.first")
                    existingWorkspaceButton.tap()
                    _ = self.dismissKnownBlockingAlertIfVisible()
                    self.logActionEnd(
                        action: "tap_element",
                        identifier: "cloudSignIn.existingWorkspace.first",
                        result: "success",
                        note: "existing workspace tapped"
                    )
                    continue
                }

                let createWorkspaceButton = self.app.buttons[LiveSmokeIdentifier.cloudSignInCreateWorkspaceButton]
                if self.waitForOptionalElement(
                    createWorkspaceButton,
                    identifier: LiveSmokeIdentifier.cloudSignInCreateWorkspaceButton,
                    timeout: self.optionalProbeTimeoutSeconds
                ) && createWorkspaceButton.isEnabled {
                    self.logActionStart(action: "tap_element", identifier: LiveSmokeIdentifier.cloudSignInCreateWorkspaceButton)
                    createWorkspaceButton.tap()
                    _ = self.dismissKnownBlockingAlertIfVisible()
                    self.logActionEnd(
                        action: "tap_element",
                        identifier: LiveSmokeIdentifier.cloudSignInCreateWorkspaceButton,
                        result: "success",
                        note: "create workspace tapped"
                    )
                    continue
                }
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }
    }

    @MainActor
    func isAccountStatusLinked() -> Bool {
        let syncNowButton = self.app.buttons[LiveSmokeIdentifier.accountStatusSyncNowButton]
        return self.waitForOptionalElement(
            syncNowButton,
            identifier: LiveSmokeIdentifier.accountStatusSyncNowButton,
            timeout: self.optionalProbeTimeoutSeconds
        )
    }

    @MainActor
    func visibleLinkedEmailLabel() -> String? {
        let linkedEmailLabel = self.app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "@")).firstMatch
        if self.waitForOptionalElement(
            linkedEmailLabel,
            identifier: "text.linkedEmail",
            timeout: self.optionalProbeTimeoutSeconds
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

        try self.assertTextExists(reviewEmail, timeout: self.optionalProbeTimeoutSeconds)
    }
}
