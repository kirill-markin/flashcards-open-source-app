#if !targetEnvironment(macCatalyst)
import SwiftUI
import UIKit

/// One native side-chat editor per window. The section panes retain their existing SwiftUI ownership, while the
/// first responder moves between plain UIView slots without rebuilding its input session.
@MainActor
@Observable
final class AICompanionComposerHost {
    @ObservationIgnored private var field: AIChatComposerUITextView?
    @ObservationIgnored weak var parkingView: UIView?

    var isFocused: Bool { self.field?.isFirstResponder == true }
    var sceneIdentifier: String? { self.parkingView?.window?.windowScene?.session.persistentIdentifier }

    func textView(input: AIChatComposerTextView, coordinator: AIChatComposerTextView.Coordinator) -> AIChatComposerUITextView {
        if let field = self.field { return field }
        let field = input.makeTextView(coordinator: coordinator)
        self.field = field
        return field
    }

    func park(from slot: AICompanionComposerSlot) {
        guard let field = self.field, field.superview === slot, let parking = self.parkingView,
              parking.window != nil else { return }
        let frame = field.convert(field.bounds, to: parking)
        field.isAccessibilityElement = false
        field.accessibilityElementsHidden = true
        field.accessibilityIdentifier = nil
        parking.addSubview(field)
        field.frame = frame
        field.autoresizingMask = []
    }

    func releaseKeyboard() {
        guard let field = self.field else { return }
        AIChatComposerUITextView.resignDeliberately { _ = field.resignFirstResponder() }
    }
}

struct AIChatCompanionComposerTextView: UIViewRepresentable {
    let input: AIChatComposerTextView
    let host: AICompanionComposerHost
    let isActive: Bool

    func makeCoordinator() -> AIChatComposerTextView.Coordinator { self.input.makeCoordinator() }

    func makeUIView(context: Context) -> AICompanionComposerSlot {
        let slot = AICompanionComposerSlot(host: self.host, field: self.host.textView(input: self.input, coordinator: context.coordinator))
        slot.isActive = self.isActive
        slot.onArrival = { [weak slot, weak coordinator = context.coordinator] in
            guard let slot, let coordinator else { return }
            Self.update(slot: slot, coordinator: coordinator)
        }
        return slot
    }

    func updateUIView(_ slot: AICompanionComposerSlot, context: Context) {
        context.coordinator.parent = self.input
        slot.isActive = self.isActive
        Self.update(slot: slot, coordinator: context.coordinator)
    }

    private static func update(slot: AICompanionComposerSlot, coordinator: AIChatComposerTextView.Coordinator) {
        guard slot.isActive, slot.window != nil else { return }
        let field = slot.field
        let isArriving = field.superview !== slot
        if isArriving {
            if let previous = field.delegate as? AIChatComposerTextView.Coordinator, previous !== coordinator {
                previous.isUpdatingView = true
                previous.setFocusBinding(false)
                previous.isUpdatingView = false
            }
            coordinator.isUpdatingView = true
            coordinator.parent.bindTextView(field, coordinator: coordinator)
            if field.isFirstResponder { coordinator.setFocusBinding(true) }
            slot.addSubview(field)
            field.isAccessibilityElement = true
            field.accessibilityElementsHidden = false
            field.frame = slot.bounds
            field.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            coordinator.parent.onWindowSceneChange(field.window?.windowScene)
            coordinator.isUpdatingView = false
            slot.invalidateIntrinsicContentSize()
        }
        coordinator.parent.updateTextView(field, coordinator: coordinator)
        // The window owns the field; its attachment callback must not retain a pane and its environment in return.
        field.onAttachmentItemProviders = { [weak coordinator] providers in
            coordinator?.parent.onAttachmentItemProviders(providers)
        }
        // Only a pane arrival may take another chat's keyboard. A normal update also follows a system keyboard
        // dismissal, before SwiftUI's focus-owner onChange runs; taking it then would immediately refocus the field.
        if isArriving {
            coordinator.takeKeyboardOnArrival(textView: field)
        }
        coordinator.scheduleFocusSync(textView: field)
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: AICompanionComposerSlot, context: Context) -> CGSize? {
        uiView.field.composerFittingSize(proposedWidth: proposal.width, maximumLineCount: self.input.maximumLineCount)
    }

    static func dismantleUIView(_ slot: AICompanionComposerSlot, coordinator: AIChatComposerTextView.Coordinator) {
        slot.host.park(from: slot)
        slot.onArrival = nil
    }
}

final class AICompanionComposerSlot: UIView {
    let host: AICompanionComposerHost
    let field: AIChatComposerUITextView
    var isActive = false
    var onArrival: (() -> Void)?

    init(host: AICompanionComposerHost, field: AIChatComposerUITextView) {
        self.host = host
        self.field = field
        super.init(frame: .zero)
        self.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func willMove(toWindow newWindow: UIWindow?) {
        if newWindow == nil { self.host.park(from: self) }
        super.willMove(toWindow: newWindow)
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if self.window != nil { self.onArrival?() }
    }
}

struct AICompanionComposerParking: UIViewRepresentable {
    let host: AICompanionComposerHost

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.clipsToBounds = true
        view.accessibilityElementsHidden = true
        return view
    }

    func updateUIView(_ view: UIView, context: Context) { self.host.parkingView = view }
}
#endif
