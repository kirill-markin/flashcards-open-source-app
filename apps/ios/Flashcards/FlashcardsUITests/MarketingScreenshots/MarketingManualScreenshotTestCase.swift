import Foundation
import XCTest

private enum MarketingManualScreenshotError: LocalizedError {
    case runtimeConfigurationReadFailed(String, underlying: Error)
    case runtimeConfigurationNotLoaded(String)
    case missingRuntimeConfigurationValue(String)
    case unsupportedLocalization(String)
    case cleanupApplicationDidNotReachForeground(timeout: TimeInterval, currentState: String)
    case cleanupLaunchPreparationFailed(String)
    case cleanupLaunchPreparationTimedOut(expectedValue: String, actualValue: String)
    case outputDirectoryCreationFailed(String, underlying: Error)
    case screenshotWriteFailed(String, underlying: Error)

    var errorDescription: String? {
        switch self {
        case .runtimeConfigurationReadFailed(let path, let underlying):
            return "Failed to read iOS marketing screenshot runtime configuration at '\(path)': \(underlying.localizedDescription)"
        case .runtimeConfigurationNotLoaded(let path):
            return "Manual iOS marketing screenshot runtime configuration was not loaded from '\(path)'."
        case .missingRuntimeConfigurationValue(let key):
            return "Manual iOS marketing screenshot runtime configuration is missing '\(key)'."
        case .unsupportedLocalization(let value):
            let supportedValues = MarketingScreenshotFixture.supportedLocalizationCodes.joined(separator: ", ")
            return "Unsupported iOS marketing screenshot localization '\(value)'. Supported values: \(supportedValues)."
        case .cleanupApplicationDidNotReachForeground(let timeout, let currentState):
            return "Marketing screenshot cleanup app did not reach the foreground within \(timeout) seconds. currentState='\(currentState)'."
        case .cleanupLaunchPreparationFailed(let message):
            return "Marketing screenshot cleanup launch preparation failed: \(message)"
        case .cleanupLaunchPreparationTimedOut(let expectedValue, let actualValue):
            return "Marketing screenshot cleanup launch preparation did not reach '\(expectedValue)'. actualValue='\(actualValue)'."
        case .outputDirectoryCreationFailed(let path, let underlying):
            return "Failed to create iOS marketing screenshot output directory at '\(path)': \(underlying.localizedDescription)"
        case .screenshotWriteFailed(let path, let underlying):
            return "Failed to write iOS marketing screenshot PNG to '\(path)': \(underlying.localizedDescription)"
        }
    }
}

enum MarketingScreenshotEnvironment {
    static let includeManualTestsKey: String = "FLASHCARDS_INCLUDE_MANUAL_SCREENSHOT_TESTS"
    static let localizationKey: String = "FLASHCARDS_MARKETING_SCREENSHOT_LOCALIZATION"
    static let outputDirectoryPathKey: String = "FLASHCARDS_MARKETING_SCREENSHOT_OUTPUT_DIRECTORY"
    static let aiHandoffCardKey: String = "FLASHCARDS_UI_TEST_AI_HANDOFF_CARD"
}

private let marketingExpectedProgressSummaryValue: String = [
    "currentStreakDays=8",
    "hasReviewedToday=true",
    "activeReviewDays=16"
].joined(separator: ";")

private let marketingExpectedReviewProgressBadgeValue: String = [
    "streakDays=8",
    "hasReviewedToday=true"
].joined(separator: ";")

private let marketingAiHandoffFirstCardValue: String = "first_card"

private enum MarketingScreenshotRuntimeConfigurationStorage {
    static let filePath: String = "/tmp/flashcards-open-source-app-ios-marketing-screenshot-config.json"
}

private struct MarketingScreenshotRuntimeConfiguration: Decodable {
    let includeManualScreenshotTests: Bool
    let outputDirectoryPath: String
    let localizationCode: String

    func validated() throws -> MarketingScreenshotRuntimeConfiguration {
        let trimmedOutputDirectoryPath = self.outputDirectoryPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedOutputDirectoryPath.isEmpty == false else {
            throw MarketingManualScreenshotError.missingRuntimeConfigurationValue("outputDirectoryPath")
        }

        let trimmedLocalizationCode = self.localizationCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedLocalizationCode.isEmpty == false else {
            throw MarketingManualScreenshotError.missingRuntimeConfigurationValue("localizationCode")
        }

        return MarketingScreenshotRuntimeConfiguration(
            includeManualScreenshotTests: self.includeManualScreenshotTests,
            outputDirectoryPath: trimmedOutputDirectoryPath,
            localizationCode: trimmedLocalizationCode
        )
    }
}

class MarketingManualScreenshotTestCase: LiveSmokeTestCase {
    private var runtimeConfiguration: MarketingScreenshotRuntimeConfiguration?

    override func setUpWithError() throws {
        try super.setUpWithError()

        let runtimeConfiguration = try self.loadRuntimeConfigurationIfPresent()
        try XCTSkipUnless(
            runtimeConfiguration?.includeManualScreenshotTests == true,
            "Manual iOS marketing screenshot tests run only from explicit wrapper scripts."
        )
        self.runtimeConfiguration = runtimeConfiguration
    }

    override func tearDownWithError() throws {
        var cleanupError: Error?

        if let runtimeConfiguration = self.runtimeConfiguration,
            runtimeConfiguration.includeManualScreenshotTests == true {
            let existingApplication = self.app
            do {
                try MainActor.assumeIsolated {
                    try Self.runMarketingGuestSessionCleanup(
                        runtimeConfiguration: runtimeConfiguration,
                        existingApplication: existingApplication
                    )
                }
            } catch {
                cleanupError = error
            }
        }

        self.runtimeConfiguration = nil

        do {
            try super.tearDownWithError()
        } catch {
            if cleanupError == nil {
                cleanupError = error
            }
        }

        if let cleanupError {
            throw cleanupError
        }
    }

    @MainActor
    func marketingLocaleFixture() throws -> MarketingScreenshotLocaleFixture {
        try Self.localeFixture(localizationCode: self.manualRuntimeConfiguration().localizationCode)
    }

    @MainActor
    func launchMarketingApplication(
        launchScenario: LiveSmokeLaunchScenario,
        selectedTab: LiveSmokeSelectedTab,
        aiHandoffCard: String?
    ) throws {
        let localeFixture = try self.marketingLocaleFixture()
        self.app = XCUIApplication()
        self.currentLaunchLocalization = localeFixture.tabBarFallbackLocalization
        Self.configureMarketingLaunchEnvironment(
            app: self.app,
            launchScenario: launchScenario,
            selectedTab: selectedTab,
            localeFixture: localeFixture,
            aiHandoffCard: aiHandoffCard
        )

        self.logActionStart(action: "launch_app", identifier: "application")
        self.app.launch()
        try self.waitForApplicationToReachForeground(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.waitForUITestLaunchPreparation(
            launchScenario: launchScenario,
            timeout: LiveSmokeConfiguration.launchPreparationTimeoutSeconds
        )
        try self.waitForSelectedTabScreen(
            selectedTab: selectedTab,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )
        self.logActionEnd(
            action: "launch_app",
            identifier: "application",
            result: "success",
            note: "application launched"
        )
    }

    @MainActor
    func launchMarketingScreenshots() throws -> MarketingScreenshotLocaleFixture {
        let localeFixture = try self.marketingLocaleFixture()

        try self.launchMarketingApplication(
            launchScenario: .marketingScreenshots,
            selectedTab: .review,
            aiHandoffCard: nil
        )
        try self.assertReviewProgressBadge()
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.reviewShowAnswerButton,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )

        return localeFixture
    }

    @MainActor
    func runMarketingGuestSessionCleanupNow() throws {
        let runtimeConfiguration = try self.manualRuntimeConfiguration()
        try Self.runMarketingGuestSessionCleanup(
            runtimeConfiguration: runtimeConfiguration,
            existingApplication: self.app
        )
    }

    @MainActor
    func assertReviewProgressBadge() throws {
        let reviewProgressBadge = self.app.buttons[LiveSmokeIdentifier.reviewProgressBadge]
        if try self.waitForElementValueContaining(
            reviewProgressBadge,
            identifier: LiveSmokeIdentifier.reviewProgressBadge,
            expectedValue: marketingExpectedReviewProgressBadgeValue,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        ) == false {
            throw LiveSmokeFailure.unexpectedElementValue(
                identifier: LiveSmokeIdentifier.reviewProgressBadge,
                expectedValue: marketingExpectedReviewProgressBadgeValue,
                actualValue: self.elementValue(element: reviewProgressBadge),
                timeoutSeconds: LiveSmokeConfiguration.longUiTimeoutSeconds,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    func openMarketingProgressFromReviewBadge() throws {
        try self.assertReviewProgressBadge()
        try self.tapButton(
            identifier: LiveSmokeIdentifier.reviewProgressBadge,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.waitForLoadedProgressScreen()
    }

    @MainActor
    func openOpportunityCostReviewCardAiDraft() throws {
        try self.launchMarketingApplication(
            launchScenario: .marketingScreenshots,
            selectedTab: .ai,
            aiHandoffCard: marketingAiHandoffFirstCardValue
        )
        try self.assertScreenVisible(screen: .ai, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
    }

    @MainActor
    func openMarketingCardsList() throws {
        try self.tapTabBarItem(selectedTab: .cards, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertScreenVisible(screen: .cards, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.cardsCardRow,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.cardsCardRow,
            index: 1,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
    }

    @MainActor
    func waitForLoadedProgressScreen() throws {
        try self.assertScreenVisible(screen: .progress, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.progressStreakSection,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.progressReviewsSection,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        let progressStreakSection = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.progressStreakSection)
            .firstMatch
        if try self.waitForElementValueContaining(
            progressStreakSection,
            identifier: LiveSmokeIdentifier.progressStreakSection,
            expectedValue: marketingExpectedProgressSummaryValue,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        ) == false {
            throw LiveSmokeFailure.unexpectedElementValue(
                identifier: LiveSmokeIdentifier.progressStreakSection,
                expectedValue: marketingExpectedProgressSummaryValue,
                actualValue: self.elementValue(element: progressStreakSection),
                timeoutSeconds: LiveSmokeConfiguration.longUiTimeoutSeconds,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    func revealOpportunityCostReviewAnswer() throws {
        let rateGoodButton = self.app.buttons[LiveSmokeIdentifier.reviewRateGoodButton]
        try self.tapButton(
            identifier: LiveSmokeIdentifier.reviewShowAnswerButton,
            timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds
        )
        if self.waitForOptionalElement(
            rateGoodButton,
            identifier: LiveSmokeIdentifier.reviewRateGoodButton,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        ) == false && self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton].exists {
            try self.tapButton(
                identifier: LiveSmokeIdentifier.reviewShowAnswerButton,
                timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds
            )
        }
        try self.waitForReviewAnswerReveal()
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.reviewRateGoodButton,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
    }

    @MainActor
    func captureMarketingScreenshot(fileName: String) throws -> URL {
        let outputDirectoryURL = try self.outputDirectoryURL()
        let screenshotURL = outputDirectoryURL.appendingPathComponent(fileName, isDirectory: false)
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = fileName
        attachment.lifetime = .keepAlways
        self.add(attachment)

        do {
            try screenshot.pngRepresentation.write(to: screenshotURL, options: .atomic)
        } catch {
            throw MarketingManualScreenshotError.screenshotWriteFailed(screenshotURL.path, underlying: error)
        }

        return screenshotURL
    }

    @MainActor
    func captureMarketingScreenshotAndAssertWritten(fileName: String) throws {
        let screenshotURL = try self.captureMarketingScreenshot(fileName: fileName)
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: screenshotURL.path),
            "Expected screenshot file at \(screenshotURL.path)."
        )
    }

    @MainActor
    func assertElementExists(
        identifier: String,
        index: Int,
        timeout: TimeInterval
    ) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "assert_element_exists.\(identifier).\(index)") {
            let indexedIdentifier = "\(identifier)[\(index)]"
            let element = self.app.descendants(matching: .any)
                .matching(identifier: identifier)
                .element(boundBy: index)

            if self.waitForOptionalElement(
                element,
                identifier: indexedIdentifier,
                timeout: timeout
            ) == false {
                throw LiveSmokeFailure.missingElement(
                    identifier: indexedIdentifier,
                    timeoutSeconds: timeout,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }
        }
    }

    private static func localeFixture(localizationCode: String) throws -> MarketingScreenshotLocaleFixture {
        guard let localeFixture = MarketingScreenshotFixture.localeFixture(localizationCode: localizationCode) else {
            throw MarketingManualScreenshotError.unsupportedLocalization(localizationCode)
        }

        return localeFixture
    }

    @MainActor
    private static func configureMarketingLaunchEnvironment(
        app: XCUIApplication,
        launchScenario: LiveSmokeLaunchScenario,
        selectedTab: LiveSmokeSelectedTab,
        localeFixture: MarketingScreenshotLocaleFixture,
        aiHandoffCard: String?
    ) {
        app.launchEnvironment.removeValue(forKey: LiveSmokeConfiguration.launchScenarioEnvironmentKey)
        app.launchEnvironment.removeValue(forKey: LiveSmokeConfiguration.appNotificationTapTypeEnvironmentKey)
        app.launchEnvironment.removeValue(forKey: MarketingScreenshotEnvironment.aiHandoffCardKey)
        app.launchEnvironment[LiveSmokeConfiguration.selectedTabEnvironmentKey] = selectedTab.rawValue
        app.launchEnvironment[LiveSmokeConfiguration.launchScenarioEnvironmentKey] = launchScenario.rawValue
        app.launchEnvironment[MarketingScreenshotEnvironment.localizationKey] = localeFixture.localizationCode
        if let aiHandoffCard {
            app.launchEnvironment[MarketingScreenshotEnvironment.aiHandoffCardKey] = aiHandoffCard
        }
        app.launchArguments = Self.strippingMarketingAppleLocalizationLaunchArguments(arguments: app.launchArguments)
        app.launchArguments += localeFixture.launchArguments
    }

    private func outputDirectoryURL() throws -> URL {
        let outputDirectoryPath = try self.manualRuntimeConfiguration().outputDirectoryPath
        let outputDirectoryURL = URL(fileURLWithPath: outputDirectoryPath, isDirectory: true)

        do {
            try FileManager.default.createDirectory(
                at: outputDirectoryURL,
                withIntermediateDirectories: true,
                attributes: nil
            )
        } catch {
            throw MarketingManualScreenshotError.outputDirectoryCreationFailed(outputDirectoryPath, underlying: error)
        }

        return outputDirectoryURL
    }

    private func manualRuntimeConfiguration() throws -> MarketingScreenshotRuntimeConfiguration {
        guard let runtimeConfiguration = self.runtimeConfiguration else {
            throw MarketingManualScreenshotError.runtimeConfigurationNotLoaded(
                MarketingScreenshotRuntimeConfigurationStorage.filePath
            )
        }

        return runtimeConfiguration
    }

    private func loadRuntimeConfigurationIfPresent() throws -> MarketingScreenshotRuntimeConfiguration? {
        let configurationURL = URL(
            fileURLWithPath: MarketingScreenshotRuntimeConfigurationStorage.filePath,
            isDirectory: false
        )

        if FileManager.default.fileExists(atPath: configurationURL.path) {
            do {
                let configurationData = try Data(contentsOf: configurationURL)
                let decodedConfiguration = try JSONDecoder().decode(
                    MarketingScreenshotRuntimeConfiguration.self,
                    from: configurationData
                )

                return try decodedConfiguration.validated()
            } catch let error as MarketingManualScreenshotError {
                throw error
            } catch {
                throw MarketingManualScreenshotError.runtimeConfigurationReadFailed(
                    configurationURL.path,
                    underlying: error
                )
            }
        }

        let environment = ProcessInfo.processInfo.environment
        guard environment[MarketingScreenshotEnvironment.includeManualTestsKey] == "true" else {
            return nil
        }

        let runtimeConfiguration = MarketingScreenshotRuntimeConfiguration(
            includeManualScreenshotTests: true,
            outputDirectoryPath: environment[MarketingScreenshotEnvironment.outputDirectoryPathKey] ?? "",
            localizationCode: environment[MarketingScreenshotEnvironment.localizationKey] ?? ""
        )

        do {
            return try runtimeConfiguration.validated()
        } catch let error as MarketingManualScreenshotError {
            throw error
        } catch {
            throw MarketingManualScreenshotError.runtimeConfigurationReadFailed(
                configurationURL.path,
                underlying: error
            )
        }
    }

    private static func strippingMarketingAppleLocalizationLaunchArguments(arguments: [String]) -> [String] {
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

    @MainActor
    private static func runMarketingGuestSessionCleanup(
        runtimeConfiguration: MarketingScreenshotRuntimeConfiguration,
        existingApplication: XCUIApplication?
    ) throws {
        let localeFixture = try Self.localeFixture(localizationCode: runtimeConfiguration.localizationCode)

        if let existingApplication, Self.applicationIsRunning(app: existingApplication) {
            existingApplication.terminate()
        }

        let cleanupApplication = XCUIApplication()
        Self.configureMarketingLaunchEnvironment(
            app: cleanupApplication,
            launchScenario: .marketingGuestSessionCleanup,
            selectedTab: .settings,
            localeFixture: localeFixture,
            aiHandoffCard: nil
        )

        cleanupApplication.launch()
        defer {
            if Self.applicationIsRunning(app: cleanupApplication) {
                cleanupApplication.terminate()
            }
        }

        try Self.waitForCleanupApplicationToReachForeground(
            app: cleanupApplication,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )
        try Self.waitForCleanupLaunchPreparation(
            app: cleanupApplication,
            launchScenario: .marketingGuestSessionCleanup,
            timeout: LiveSmokeConfiguration.launchPreparationTimeoutSeconds
        )
    }

    @MainActor
    private static func waitForCleanupApplicationToReachForeground(
        app: XCUIApplication,
        timeout: TimeInterval
    ) throws {
        let reachedForeground = app.wait(for: .runningForeground, timeout: timeout)
        if reachedForeground == false {
            throw MarketingManualScreenshotError.cleanupApplicationDidNotReachForeground(
                timeout: timeout,
                currentState: Self.applicationStateDescription(app: app)
            )
        }
    }

    @MainActor
    private static func waitForCleanupLaunchPreparation(
        app: XCUIApplication,
        launchScenario: LiveSmokeLaunchScenario,
        timeout: TimeInterval
    ) throws {
        let statusElement = app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.uiTestLaunchPreparationStatus)
            .firstMatch
        let readyValue = "state=ready;launchScenario=\(launchScenario.rawValue)"
        let failedValuePrefix = "state=failed;launchScenario=\(launchScenario.rawValue)"
        let deadline = Date().addingTimeInterval(timeout)

        while Date() < deadline {
            if statusElement.exists {
                let currentValue = Self.elementValue(element: statusElement)
                if currentValue.contains(readyValue) {
                    return
                }

                if currentValue.contains(failedValuePrefix) {
                    throw MarketingManualScreenshotError.cleanupLaunchPreparationFailed(currentValue)
                }
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }

        let actualValue = statusElement.exists ? Self.elementValue(element: statusElement) : "missing_marker"
        throw MarketingManualScreenshotError.cleanupLaunchPreparationTimedOut(
            expectedValue: readyValue,
            actualValue: actualValue
        )
    }

    @MainActor
    private static func applicationIsRunning(app: XCUIApplication) -> Bool {
        switch app.state {
        case .runningForeground, .runningBackground, .runningBackgroundSuspended:
            return true
        case .unknown, .notRunning:
            return false
        @unknown default:
            return false
        }
    }

    @MainActor
    private static func applicationStateDescription(app: XCUIApplication) -> String {
        switch app.state {
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
    private static func elementValue(element: XCUIElement) -> String {
        if let value = element.value as? String {
            return value.trimmingCharacters(in: .whitespacesAndNewlines)
        }

        if let value = element.value {
            return String(describing: value).trimmingCharacters(in: .whitespacesAndNewlines)
        }

        return element.label.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
