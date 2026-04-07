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

        try self.assertLinkedEmailVisible(reviewEmail: reviewEmail, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.accountStatusSyncNowButton,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.tapFirstNavigationBackButton()
        try self.tapFirstNavigationBackButton()
    }

    @MainActor
    func createEphemeralWorkspace(workspaceName: String) throws {
        try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButton(
            identifier: LiveSmokeIdentifier.settingsCurrentWorkspaceRow,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .currentWorkspace, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButton(
            identifier: LiveSmokeIdentifier.currentWorkspaceRowButton,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )
        try self.assertCurrentWorkspacePickerIsVisible()
        try self.tapButton(
            identifier: LiveSmokeIdentifier.currentWorkspaceCreateButton,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )
        try self.tapFirstNavigationBackButton()

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
        try self.tapButton(
            identifier: LiveSmokeIdentifier.workspaceOverviewDeleteWorkspaceButton,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )

        try self.tapAlertButton(label: "Continue", timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)

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
    func openAccountStatus() throws {
        try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButton(
            identifier: LiveSmokeIdentifier.settingsAccountSettingsRow,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .accountSettings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButton(
            identifier: LiveSmokeIdentifier.accountSettingsAccountStatusRow,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .accountStatus, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
    }

    @MainActor
    func openWorkspaceOverviewFromSettings() throws {
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
    func completeCloudWorkspaceSelectionIfNeeded() throws {
        let deadline = Date().addingTimeInterval(LiveSmokeConfiguration.longUiTimeoutSeconds)
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
                timeout: LiveSmokeConfiguration.optionalProbeTimeoutSeconds
            )

            if chooserVisible {
                let existingWorkspaceButton = self.app.buttons.matching(existingWorkspacePredicate).firstMatch
                if self.waitForOptionalElement(
                    existingWorkspaceButton,
                    identifier: "cloudSignIn.existingWorkspace.first",
                    timeout: LiveSmokeConfiguration.optionalProbeTimeoutSeconds
                ) && existingWorkspaceButton.isEnabled {
                    try self.tapButton(
                        button: existingWorkspaceButton,
                        identifier: "cloudSignIn.existingWorkspace.first",
                        timeout: LiveSmokeConfiguration.optionalProbeTimeoutSeconds
                    )
                    continue
                }

                let createWorkspaceButton = self.app.buttons[LiveSmokeIdentifier.cloudSignInCreateWorkspaceButton]
                if self.waitForOptionalElement(
                    createWorkspaceButton,
                    identifier: LiveSmokeIdentifier.cloudSignInCreateWorkspaceButton,
                    timeout: LiveSmokeConfiguration.optionalProbeTimeoutSeconds
                ) && createWorkspaceButton.isEnabled {
                    try self.tapButton(
                        identifier: LiveSmokeIdentifier.cloudSignInCreateWorkspaceButton,
                        timeout: LiveSmokeConfiguration.optionalProbeTimeoutSeconds
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
            timeout: LiveSmokeConfiguration.optionalProbeTimeoutSeconds
        )
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
