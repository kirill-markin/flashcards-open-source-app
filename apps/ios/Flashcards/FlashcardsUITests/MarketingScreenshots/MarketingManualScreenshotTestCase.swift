import Foundation
import XCTest

private enum MarketingManualScreenshotError: LocalizedError {
    case runtimeConfigurationReadFailed(String, underlying: Error)
    case runtimeConfigurationNotLoaded(String)
    case missingRuntimeConfigurationValue(String)
    case unsupportedLocalization(String)
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

    @MainActor
    func marketingLocaleFixture() throws -> MarketingScreenshotLocaleFixture {
        let rawValue = try self.manualRuntimeConfiguration().localizationCode
        guard let localeFixture = MarketingScreenshotFixture.localeFixture(localizationCode: rawValue) else {
            throw MarketingManualScreenshotError.unsupportedLocalization(rawValue)
        }

        return localeFixture
    }

    @MainActor
    func launchMarketingApplication(
        resetState: LiveSmokeLaunchResetState,
        selectedTab: LiveSmokeSelectedTab,
        aiHandoffCard: String?
    ) throws {
        let localeFixture = try self.marketingLocaleFixture()
        self.app = XCUIApplication()
        self.currentLaunchLocalization = localeFixture.tabBarFallbackLocalization
        self.configureMarketingLaunchEnvironment(
            app: self.app,
            resetState: resetState,
            selectedTab: selectedTab,
            localeFixture: localeFixture,
            aiHandoffCard: aiHandoffCard
        )

        self.logActionStart(action: "launch_app", identifier: "application")
        self.app.launch()
        try self.waitForApplicationToReachForeground(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
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
    func launchOpportunityCostReviewCard() throws -> MarketingScreenshotLocaleFixture {
        let localeFixture = try self.marketingLocaleFixture()

        try self.launchMarketingApplication(
            resetState: .marketingOpportunityCostReviewCard,
            selectedTab: .review,
            aiHandoffCard: nil
        )
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.reviewShowAnswerButton,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )

        return localeFixture
    }

    @MainActor
    func launchOpportunityCostReviewCardAiHandoff() throws {
        if self.isApplicationRunning {
            self.app.terminate()
        }

        try self.launchMarketingApplication(
            resetState: .marketingOpportunityCostReviewCard,
            selectedTab: .ai,
            aiHandoffCard: "first_card"
        )
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

    @MainActor
    private func configureMarketingLaunchEnvironment(
        app: XCUIApplication,
        resetState: LiveSmokeLaunchResetState,
        selectedTab: LiveSmokeSelectedTab,
        localeFixture: MarketingScreenshotLocaleFixture,
        aiHandoffCard: String?
    ) {
        app.launchEnvironment.removeValue(forKey: LiveSmokeConfiguration.resetStateEnvironmentKey)
        app.launchEnvironment.removeValue(forKey: LiveSmokeConfiguration.appNotificationTapTypeEnvironmentKey)
        app.launchEnvironment.removeValue(forKey: MarketingScreenshotEnvironment.aiHandoffCardKey)
        app.launchEnvironment[LiveSmokeConfiguration.selectedTabEnvironmentKey] = selectedTab.rawValue
        app.launchEnvironment[LiveSmokeConfiguration.resetStateEnvironmentKey] = resetState.rawValue
        app.launchEnvironment[MarketingScreenshotEnvironment.localizationKey] = localeFixture.localizationCode
        if let aiHandoffCard {
            app.launchEnvironment[MarketingScreenshotEnvironment.aiHandoffCardKey] = aiHandoffCard
        }
        app.launchArguments = self.strippingMarketingAppleLocalizationLaunchArguments(arguments: app.launchArguments)
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

    private func strippingMarketingAppleLocalizationLaunchArguments(arguments: [String]) -> [String] {
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
