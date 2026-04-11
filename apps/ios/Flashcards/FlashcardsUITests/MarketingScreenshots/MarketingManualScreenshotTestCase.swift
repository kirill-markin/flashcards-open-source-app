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
            return "Unsupported iOS marketing screenshot localization '\(value)'."
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
    func marketingLaunchLocalization() throws -> LiveSmokeLaunchLocalization {
        let rawValue = try self.requiredEnvironmentValue(key: MarketingScreenshotEnvironment.localizationKey)

        switch rawValue {
        case "en":
            return .english
        case "ar":
            return .arabic
        default:
            throw MarketingManualScreenshotError.unsupportedLocalization(rawValue)
        }
    }

    @MainActor
    func launchMarketingApplication(
        resetState: LiveSmokeLaunchResetState,
        selectedTab: LiveSmokeSelectedTab
    ) throws {
        let localization = try self.marketingLaunchLocalization()
        try self.launchApplication(
            resetState: resetState,
            selectedTab: selectedTab,
            launchLocalization: localization
        )
    }

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
}
