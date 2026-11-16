#if !targetEnvironment(macCatalyst)
import SwiftUI
import UIKit

/// Extends the main chat's transcript-tap dismissal to both side-chat columns. Its background measures the composer
/// accessory, while a non-cancelling window tap also reaches controls and empty space in the other column.
struct AIChatOutsideTapObserver: UIViewRepresentable {
    let isEnabled: Bool
    let onDismiss: () -> Void

    func makeUIView(context: Context) -> AIChatOutsideTapView {
        let view = AIChatOutsideTapView()
        view.isUserInteractionEnabled = false
        view.accessibilityElementsHidden = true
        return view
    }

    func updateUIView(_ view: AIChatOutsideTapView, context: Context) {
        view.onDismiss = self.onDismiss
        view.outsideTap.isEnabled = self.isEnabled
    }

    static func dismantleUIView(_ view: AIChatOutsideTapView, coordinator: Void) {
        view.removeOutsideTap()
        view.onDismiss = nil
    }
}

final class AIChatOutsideTapView: UIView, UIGestureRecognizerDelegate {
    var onDismiss: (() -> Void)?
    lazy var outsideTap: UITapGestureRecognizer = {
        let tap = UITapGestureRecognizer(target: self, action: #selector(self.dismissComposer))
        tap.cancelsTouchesInView = false
        tap.delaysTouchesBegan = false
        tap.delaysTouchesEnded = false
        tap.delegate = self
        return tap
    }()

    override func didMoveToWindow() {
        super.didMoveToWindow()
        self.removeOutsideTap()
        self.window?.addGestureRecognizer(self.outsideTap)
    }

    func removeOutsideTap() {
        self.outsideTap.view?.removeGestureRecognizer(self.outsideTap)
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        guard let window = self.window, isActiveKeyboardWindow(window),
              keyboardFirstResponderView(in: window) is AIChatComposerUITextView,
              window.rootViewController.map({ hasCoveringPresentation($0) }) == false,
              self.bounds.contains(touch.location(in: self)) == false else { return false }
        // Section and navigation-bar controls keep the keyboard, as UIKit bars do. Removing this condition opts the bars into dismissal.
        if let view = touch.view, Self.isSectionBarControl(view) { return false }
        // Another text input takes the keyboard over directly; resigning the composer first would hide and reshow it.
        if let view = touch.view, Self.isEditableTextInput(view) { return false }
        return true
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        true
    }

    @objc private func dismissComposer() {
        // A target may already have dismissed the chat or focused its own editor during this same tap.
        guard let window = self.window,
              keyboardFirstResponderView(in: window) is AIChatComposerUITextView else { return }
        self.onDismiss?()
    }

    private static func isEditableTextInput(_ view: UIView) -> Bool {
        var ancestor: UIView? = view
        while let current = ancestor {
            if let textView = current as? UITextView { return textView.isEditable }
            if current is UITextInput { return true }
            ancestor = current.superview
        }
        return false
    }

    private static func isSectionBarControl(_ view: UIView) -> Bool {
        if AIChatSectionSwitchTouchTracker.isSectionItem(view) { return true }
        var ancestor: UIView? = view
        var isControl = false
        while let current = ancestor {
            if current is UIControl || current is UICollectionViewCell { isControl = true }
            if current is UINavigationBar || current is UIToolbar || current is UITabBar { return isControl }
            ancestor = current.superview
        }
        return false
    }
}
#endif
