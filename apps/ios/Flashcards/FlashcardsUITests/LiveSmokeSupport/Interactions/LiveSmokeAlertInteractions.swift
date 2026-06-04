import Foundation
import XCTest

extension LiveSmokeTestCase {
    @MainActor
    func tapAlertButton(label: String, timeout: TimeInterval) throws {
        let identifier = "alert.\(label)"
        let button = self.app.alerts.buttons[label].firstMatch
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_alert_button.\(label)") {
            if self.waitForOptionalElement(
                button,
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

            try self.tapExistingButton(
                button,
                identifier: identifier,
                action: "tap_alert_button",
                note: "alert button tapped"
            )
        }
    }

    @MainActor
    func tapAlertButtonPreservingAlerts(label: String, timeout: TimeInterval) throws {
        let identifier = "alert.\(label)"
        let button = self.app.alerts.buttons[label].firstMatch
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_alert_button_preserving_alerts.\(label)") {
            let deadline = Date().addingTimeInterval(timeout)
            while Date() < deadline && button.exists == false {
                RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
            }

            if button.exists == false {
                throw LiveSmokeFailure.missingElement(
                    identifier: identifier,
                    timeoutSeconds: timeout,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }

            if button.isEnabled == false {
                throw LiveSmokeFailure.disabledElement(
                    identifier: identifier,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }

            try self.tapExistingButtonPreservingAlerts(
                button,
                identifier: identifier,
                action: "tap_alert_button_preserving_alerts",
                note: "alert button tapped without dismissal"
            )
        }
    }
}
