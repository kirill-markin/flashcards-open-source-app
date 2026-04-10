import XCTest

extension LiveSmokeTestCase {
    @MainActor
    func launchApplication(
        resetState: LiveSmokeLaunchResetState?,
        selectedTab: LiveSmokeSelectedTab
    ) throws {
        try self.launchApplication(
            resetState: resetState,
            selectedTab: selectedTab,
            launchLocalization: .english
        )
    }

    @MainActor
    func launchApplication(
        resetState: LiveSmokeLaunchResetState?,
        selectedTab: LiveSmokeSelectedTab,
        launchLocalization: LiveSmokeLaunchLocalization
    ) throws {
        try self.launchApplication(
            request: LiveSmokeLaunchRequest(
                resetState: resetState,
                selectedTab: selectedTab,
                launchLocalization: launchLocalization,
                appNotificationTapType: nil
            )
        )
    }

    @MainActor
    func launchApplicationWithAppNotificationTap(
        resetState: LiveSmokeLaunchResetState?,
        selectedTab: LiveSmokeSelectedTab,
        appNotificationTapType: LiveSmokeAppNotificationTapType
    ) throws {
        try self.launchApplicationWithAppNotificationTap(
            resetState: resetState,
            selectedTab: selectedTab,
            launchLocalization: .english,
            appNotificationTapType: appNotificationTapType
        )
    }

    @MainActor
    func launchApplicationWithAppNotificationTap(
        resetState: LiveSmokeLaunchResetState?,
        selectedTab: LiveSmokeSelectedTab,
        launchLocalization: LiveSmokeLaunchLocalization,
        appNotificationTapType: LiveSmokeAppNotificationTapType
    ) throws {
        try self.launchApplication(
            request: LiveSmokeLaunchRequest(
                resetState: resetState,
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
        try self.assertScreenVisible(screen: selectedTab.screen, timeout: timeout)
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
        self.app.launchEnvironment.removeValue(forKey: LiveSmokeConfiguration.resetStateEnvironmentKey)
        self.app.launchEnvironment.removeValue(forKey: LiveSmokeConfiguration.appNotificationTapTypeEnvironmentKey)
        self.app.launchEnvironment[LiveSmokeConfiguration.selectedTabEnvironmentKey] = request.selectedTab.rawValue
        self.app.launchArguments = self.strippingAppleLocalizationLaunchArguments(
            arguments: self.app.launchArguments
        )
        self.app.launchArguments += request.launchLocalization.launchArguments
        if let resetState = request.resetState {
            self.app.launchEnvironment[LiveSmokeConfiguration.resetStateEnvironmentKey] = resetState.rawValue
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
