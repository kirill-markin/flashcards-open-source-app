import Foundation
import XCTest

private enum MarketingManualScreenshotError: LocalizedError {
    case missingEnvironmentValue(String)
    case unsupportedLocalization(String)
    case outputDirectoryCreationFailed(String, underlying: Error)
    case screenshotWriteFailed(String, underlying: Error)

    var errorDescription: String? {
        switch self {
        case .missingEnvironmentValue(let key):
            return "Manual iOS marketing screenshot environment is missing '\(key)'."
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
    static let includeManualOnlyKey: String = "FLASHCARDS_INCLUDE_MANUAL_SCREENSHOT_TESTS"
    static let outputDirectoryKey: String = "FLASHCARDS_MARKETING_SCREENSHOT_OUTPUT_DIR"
    static let localizationKey: String = "FLASHCARDS_MARKETING_SCREENSHOT_LOCALIZATION"
}

class MarketingManualScreenshotTestCase: LiveSmokeTestCase {
    override func setUpWithError() throws {
        try super.setUpWithError()

        let includeManualOnly = ProcessInfo.processInfo.environment[MarketingScreenshotEnvironment.includeManualOnlyKey]
        try XCTSkipUnless(
            includeManualOnly == "true",
            "Manual iOS marketing screenshot tests run only from explicit wrapper scripts."
        )
    }

    @MainActor
    func marketingLocaleFixture() throws -> MarketingScreenshotLocaleFixture {
        let rawValue = try self.requiredEnvironmentValue(key: MarketingScreenshotEnvironment.localizationKey)
        guard let localeFixture = MarketingScreenshotFixture.localeFixture(localizationCode: rawValue) else {
            throw MarketingManualScreenshotError.unsupportedLocalization(rawValue)
        }

        return localeFixture
    }

    @MainActor
    func launchMarketingApplication(
        resetState: LiveSmokeLaunchResetState,
        selectedTab: LiveSmokeSelectedTab
    ) throws {
        let localeFixture = try self.marketingLocaleFixture()
        self.app = XCUIApplication()
        self.currentLaunchLocalization = localeFixture.tabBarFallbackLocalization
        self.configureMarketingLaunchEnvironment(
            app: self.app,
            resetState: resetState,
            selectedTab: selectedTab,
            localeFixture: localeFixture
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
    private func configureMarketingLaunchEnvironment(
        app: XCUIApplication,
        resetState: LiveSmokeLaunchResetState,
        selectedTab: LiveSmokeSelectedTab,
        localeFixture: MarketingScreenshotLocaleFixture
    ) {
        app.launchEnvironment.removeValue(forKey: LiveSmokeConfiguration.resetStateEnvironmentKey)
        app.launchEnvironment.removeValue(forKey: LiveSmokeConfiguration.appNotificationTapTypeEnvironmentKey)
        app.launchEnvironment[LiveSmokeConfiguration.selectedTabEnvironmentKey] = selectedTab.rawValue
        app.launchEnvironment[LiveSmokeConfiguration.resetStateEnvironmentKey] = resetState.rawValue
        app.launchEnvironment[MarketingScreenshotEnvironment.localizationKey] = localeFixture.localizationCode
        app.launchArguments = self.strippingMarketingAppleLocalizationLaunchArguments(arguments: app.launchArguments)
        app.launchArguments += localeFixture.launchArguments
    }

    private func outputDirectoryURL() throws -> URL {
        let outputDirectoryPath = try self.requiredEnvironmentValue(key: MarketingScreenshotEnvironment.outputDirectoryKey)
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

    private func requiredEnvironmentValue(key: String) throws -> String {
        guard let value = ProcessInfo.processInfo.environment[key] else {
            throw MarketingManualScreenshotError.missingEnvironmentValue(key)
        }

        let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedValue.isEmpty == false else {
            throw MarketingManualScreenshotError.missingEnvironmentValue(key)
        }

        return trimmedValue
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
