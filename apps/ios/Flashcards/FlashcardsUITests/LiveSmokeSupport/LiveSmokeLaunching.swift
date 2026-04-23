import XCTest

extension LiveSmokeTestCase {
    @MainActor
    func launchApplication(
        launchScenario: LiveSmokeLaunchScenario?,
        selectedTab: LiveSmokeSelectedTab
    ) throws {
        try self.launchApplication(
            launchScenario: launchScenario,
            selectedTab: selectedTab,
            launchLocalization: .english
        )
    }

    @MainActor
    func launchApplication(
        launchScenario: LiveSmokeLaunchScenario?,
        selectedTab: LiveSmokeSelectedTab,
        launchLocalization: LiveSmokeLaunchLocalization
    ) throws {
        try self.launchApplication(
            request: LiveSmokeLaunchRequest(
                launchScenario: launchScenario,
                selectedTab: selectedTab,
                launchLocalization: launchLocalization,
                appNotificationTapType: nil
            )
        )
    }

    @MainActor
    func launchApplicationWithAppNotificationTap(
        launchScenario: LiveSmokeLaunchScenario?,
        selectedTab: LiveSmokeSelectedTab,
        appNotificationTapType: LiveSmokeAppNotificationTapType
    ) throws {
        try self.launchApplicationWithAppNotificationTap(
            launchScenario: launchScenario,
            selectedTab: selectedTab,
            launchLocalization: .english,
            appNotificationTapType: appNotificationTapType
        )
    }

    @MainActor
    func launchApplicationWithAppNotificationTap(
        launchScenario: LiveSmokeLaunchScenario?,
        selectedTab: LiveSmokeSelectedTab,
        launchLocalization: LiveSmokeLaunchLocalization,
        appNotificationTapType: LiveSmokeAppNotificationTapType
    ) throws {
        try self.launchApplication(
            request: LiveSmokeLaunchRequest(
                launchScenario: launchScenario,
                selectedTab: selectedTab,
                launchLocalization: launchLocalization,
                appNotificationTapType: appNotificationTapType
            )
        )
    }

    @MainActor
    func waitForApplicationToReachForeground(timeout: TimeInterval) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "wait_for_app_foreground") {
            self.logSmokeBreadcrumb(
                event: "wait_start",
                action: "wait_for_app_foreground",
                identifier: "application",
                timeoutSeconds: formatDuration(seconds: timeout),
                durationSeconds: "-",
                result: "start",
                note: "waiting for runningForeground",
                captureScreenSummary: false,
                screenOverride: "appState=\(self.appStateDescription()) screens=[-] nav=[-] alerts=[-] tabs=[-]"
            )
            let startedAt = Date()
            let reachedForeground = self.app.wait(for: .runningForeground, timeout: timeout)
            let durationSeconds = Date().timeIntervalSince(startedAt)
            self.logSmokeBreadcrumb(
                event: "wait_end",
                action: "wait_for_app_foreground",
                identifier: "application",
                timeoutSeconds: formatDuration(seconds: timeout),
                durationSeconds: formatDuration(seconds: durationSeconds),
                result: reachedForeground ? "success" : "failure",
                note: "foreground wait finished",
                captureScreenSummary: false,
                screenOverride: reachedForeground ? nil : "appState=\(self.appStateDescription()) screens=[-] nav=[-] alerts=[-] tabs=[-]"
            )

            if reachedForeground == false {
                throw LiveSmokeFailure.appDidNotReachForeground(
                    timeoutSeconds: timeout,
                    appState: self.appStateDescription(),
                    step: self.currentStepTitle
                )
            }
        }
    }

    @MainActor
    func waitForSelectedTabScreen(selectedTab: LiveSmokeSelectedTab, timeout: TimeInterval) throws {
        switch selectedTab {
        case .review:
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.reviewShowAnswerButton,
                timeout: timeout
            )
        case .ai, .progress, .cards, .settings:
            try self.assertScreenVisible(screen: selectedTab.screen, timeout: timeout)
        }
    }

    @MainActor
    func waitForUITestLaunchPreparation(
        launchScenario: LiveSmokeLaunchScenario,
        timeout: TimeInterval
    ) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "wait_for_ui_test_launch_preparation.\(launchScenario.rawValue)") {
            let element = self.app.descendants(matching: .any)
                .matching(identifier: LiveSmokeIdentifier.uiTestLaunchPreparationStatus)
                .firstMatch
            let readyValue = "state=ready;launchScenario=\(launchScenario.rawValue)"
            let failedValuePrefix = "state=failed;launchScenario=\(launchScenario.rawValue)"

            self.logSmokeBreadcrumb(
                event: "wait_start",
                action: "wait_for_ui_test_launch_preparation",
                identifier: LiveSmokeIdentifier.uiTestLaunchPreparationStatus,
                timeoutSeconds: formatDuration(seconds: timeout),
                durationSeconds: "-",
                result: "start",
                note: readyValue
            )

            let startedAt = Date()
            let deadline = startedAt.addingTimeInterval(timeout)
            while Date() < deadline {
                if element.exists {
                    let currentValue = self.elementValue(element: element)
                    if currentValue.contains(readyValue) {
                        let durationSeconds = Date().timeIntervalSince(startedAt)
                        self.logSmokeBreadcrumb(
                            event: "wait_end",
                            action: "wait_for_ui_test_launch_preparation",
                            identifier: LiveSmokeIdentifier.uiTestLaunchPreparationStatus,
                            timeoutSeconds: formatDuration(seconds: timeout),
                            durationSeconds: formatDuration(seconds: durationSeconds),
                            result: "success",
                            note: currentValue
                        )
                        return
                    }

                    if currentValue.contains(failedValuePrefix) {
                        throw LiveSmokeFailure.uiTestLaunchPreparationFailed(
                            launchScenario: launchScenario.rawValue,
                            message: currentValue,
                            screen: self.currentScreenSummary(),
                            step: self.currentStepTitle
                        )
                    }
                }

                RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
            }

            let durationSeconds = Date().timeIntervalSince(startedAt)
            self.logSmokeBreadcrumb(
                event: "wait_end",
                action: "wait_for_ui_test_launch_preparation",
                identifier: LiveSmokeIdentifier.uiTestLaunchPreparationStatus,
                timeoutSeconds: formatDuration(seconds: timeout),
                durationSeconds: formatDuration(seconds: durationSeconds),
                result: "failure",
                note: element.exists ? self.elementValue(element: element) : "missing_marker"
            )

            if element.exists == false {
                throw LiveSmokeFailure.missingElement(
                    identifier: LiveSmokeIdentifier.uiTestLaunchPreparationStatus,
                    timeoutSeconds: timeout,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }

            throw LiveSmokeFailure.unexpectedElementValue(
                identifier: LiveSmokeIdentifier.uiTestLaunchPreparationStatus,
                expectedValue: readyValue,
                actualValue: self.elementValue(element: element),
                timeoutSeconds: timeout,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    var isApplicationRunning: Bool {
        guard self.app != nil else {
            return false
        }

        switch self.app.state {
        case .runningForeground:
            return true
        case .unknown, .notRunning, .runningBackground, .runningBackgroundSuspended:
            return false
        @unknown default:
            return false
        }
    }

    @MainActor
    func appStateDescription() -> String {
        guard self.app != nil else {
            return "uninitialized"
        }

        switch self.app.state {
        case .unknown:
            return "unknown"
        case .notRunning:
            return "notRunning"
        case .runningBackgroundSuspended:
            return "runningBackgroundSuspended"
        case .runningBackground:
            return "runningBackground"
        case .runningForeground:
            return "runningForeground"
        @unknown default:
            return "unknownFutureState"
        }
    }

    @MainActor
    private func launchApplication(request: LiveSmokeLaunchRequest) throws {
        self.app = XCUIApplication()
        self.configureLaunchEnvironment(request: request)
        let action = request.appNotificationTapType == nil ? "launch_app" : "launch_app_notification_tap"
        let note = request.appNotificationTapType == nil
            ? "application launched"
            : "application launched with app notification tap"

        self.logActionStart(action: action, identifier: "application")
        self.app.launch()
        try self.waitForApplicationToReachForeground(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        if let launchScenario = request.launchScenario {
            try self.waitForUITestLaunchPreparation(
                launchScenario: launchScenario,
                timeout: LiveSmokeConfiguration.launchPreparationTimeoutSeconds
            )
        }
        if request.appNotificationTapType == nil {
            try self.waitForSelectedTabScreen(
                selectedTab: request.selectedTab,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
        }
        self.logActionEnd(action: action, identifier: "application", result: "success", note: note)
    }

    @MainActor
    private func configureLaunchEnvironment(request: LiveSmokeLaunchRequest) {
        self.currentLaunchLocalization = request.launchLocalization
        self.app.launchEnvironment.removeValue(forKey: LiveSmokeConfiguration.launchScenarioEnvironmentKey)
        self.app.launchEnvironment.removeValue(forKey: LiveSmokeConfiguration.appNotificationTapTypeEnvironmentKey)
        self.app.launchEnvironment[LiveSmokeConfiguration.selectedTabEnvironmentKey] = request.selectedTab.rawValue
        self.app.launchArguments = self.strippingAppleLocalizationLaunchArguments(
            arguments: self.app.launchArguments
        )
        self.app.launchArguments += request.launchLocalization.launchArguments
        if let launchScenario = request.launchScenario {
            self.app.launchEnvironment[LiveSmokeConfiguration.launchScenarioEnvironmentKey] = launchScenario.rawValue
        }
        if let appNotificationTapType = request.appNotificationTapType {
            self.app.launchEnvironment[LiveSmokeConfiguration.appNotificationTapTypeEnvironmentKey] = appNotificationTapType.rawValue
        }
    }

    private func strippingAppleLocalizationLaunchArguments(arguments: [String]) -> [String] {
        var sanitizedArguments: [String] = []
        var index = 0

        while index < arguments.count {
            let argument = arguments[index]
            if argument == "-AppleLanguages" || argument == "-AppleLocale" {
                index += 2
                continue
            }

            sanitizedArguments.append(argument)
            index += 1
        }

        return sanitizedArguments
    }
}
