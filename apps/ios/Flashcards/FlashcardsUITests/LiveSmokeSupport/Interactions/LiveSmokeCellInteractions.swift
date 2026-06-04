import Foundation
import XCTest

extension LiveSmokeTestCase {
    @MainActor
    func tapCell(identifier: String, timeout: TimeInterval) throws {
        let cell = self.app.cells[identifier].firstMatch
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_cell.\(identifier)") {
            if self.waitForOptionalElement(
                cell,
                identifier: identifier,
                timeout: timeout
            ) == false {
                throw LiveSmokeFailure.missingElement(
                    identifier: identifier,
                    timeoutSeconds: timeout,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }

            try self.tapExistingCell(cell, identifier: identifier)
        }
    }

    @MainActor
    private func tapExistingCell(_ cell: XCUIElement, identifier: String) throws {
        if cell.isEnabled == false {
            throw LiveSmokeFailure.disabledElement(
                identifier: identifier,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        self.logActionStart(action: "tap_cell", identifier: identifier)
        cell.tap()
        self.logActionEnd(action: "tap_cell", identifier: identifier, result: "success", note: "cell tapped")
    }
}
