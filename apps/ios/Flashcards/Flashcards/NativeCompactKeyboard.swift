import SwiftUI
import UIKit
#if DEBUG
import OSLog
#endif

extension View {
    @ViewBuilder
    func nativeCompactKeyboard() -> some View {
        #if targetEnvironment(macCatalyst)
        self
        #else
        self
            .autocorrectionDisabled()
            .writingToolsBehavior(.disabled)
        #endif
    }
}

#if !targetEnvironment(macCatalyst)
protocol NativeCompactKeyboardPreparedInput: AnyObject {}

/// SwiftUI inherits its traits from the root; the native composer uses the same policy before focus.
@MainActor
enum NativeCompactKeyboard {
    private static let observer = EditingObserver()

    static func install() {
        _ = self.observer
    }

    static func configureTextView(_ textView: UITextView) {
        textView.autocorrectionType = .no
        textView.spellCheckingType = .no
        textView.inlinePredictionType = .no
        textView.mathExpressionCompletionType = .no
        textView.writingToolsBehavior = .none
        self.removeShortcuts(from: textView)
    }

    private static func removeShortcuts(from responder: UIResponder) {
        responder.inputAssistantItem.leadingBarButtonGroups = []
        responder.inputAssistantItem.trailingBarButtonGroups = []
    }

    @MainActor
    private final class EditingObserver: NSObject {
        #if DEBUG
        private weak var activeInput: UIResponder?
        private let logger = Logger(subsystem: appBundleIdentifier(), category: "compact_keyboard")
        #endif

        override init() {
            super.init()
            // Notifications carry the control directly, including SwiftUI fields and alerts.
            for name in [UITextField.textDidBeginEditingNotification, UITextView.textDidBeginEditingNotification] {
                NotificationCenter.default.addObserver(self, selector: #selector(self.editingBegan(_:)), name: name, object: nil)
            }
            #if DEBUG
            if AutomationRun.current.isAutomation {
                for name in [UIResponder.keyboardWillShowNotification, UIResponder.keyboardWillChangeFrameNotification] {
                    NotificationCenter.default.addObserver(self, selector: #selector(self.keyboardFrame(_:)), name: name, object: nil)
                }
            }
            #endif
        }

        @objc private func editingBegan(_ notification: Notification) {
            guard let responder = notification.object as? UIResponder else { return }
            #if DEBUG
            self.activeInput = responder
            if AutomationRun.current.isAutomation {
                let identifier = (responder as? UIView)?.accessibilityIdentifier ?? (responder as? UITextField)?.placeholder ?? "UITextView"
                self.logger.log("compact_keyboard_focus input=\(identifier, privacy: .public)")
            }
            #endif
            if let field = responder as? UITextField {
                field.spellCheckingType = .no
                field.inlinePredictionType = .no
            } else if let textView = responder as? UITextView, (responder is NativeCompactKeyboardPreparedInput) == false {
                textView.spellCheckingType = .no
                textView.inlinePredictionType = .no
            }
            if (responder is NativeCompactKeyboardPreparedInput) == false {
                NativeCompactKeyboard.removeShortcuts(from: responder)
            }
        }

        #if DEBUG
        @objc private func keyboardFrame(_ notification: Notification) {
            guard let frame = (notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue else { return }
            let identifier: String
            let contentType: String
            let autocorrection: Int
            if let field = self.activeInput as? UITextField {
                identifier = field.accessibilityIdentifier ?? field.placeholder ?? "UITextField"
                contentType = field.textContentType?.rawValue ?? "nil"
                autocorrection = field.autocorrectionType.rawValue
            } else if let textView = self.activeInput as? UITextView {
                identifier = textView.accessibilityIdentifier ?? "UITextView"
                contentType = textView.textContentType?.rawValue ?? "nil"
                autocorrection = textView.autocorrectionType.rawValue
            } else {
                return
            }
            self.logger.log("compact_keyboard_frame event=\(notification.name.rawValue, privacy: .public) input=\(identifier, privacy: .public) contentType=\(contentType, privacy: .public) autocorrection=\(autocorrection) top=\(Double(frame.minY)) height=\(Double(frame.height))")
        }
        #endif
    }
}
#endif
