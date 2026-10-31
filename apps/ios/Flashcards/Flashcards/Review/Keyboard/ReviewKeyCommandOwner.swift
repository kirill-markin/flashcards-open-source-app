import SwiftUI
import UIKit

/// The Review key actions of one window: its Review publishes them, and the window's
/// `ReviewKeyCommandController` and the Review menu read them.
@MainActor
@Observable
final class ReviewKeyCommandTarget {
    private(set) var actions: ReviewKeyboardActions?
    @ObservationIgnored private weak var publisher: AnyObject?
    @ObservationIgnored var onAvailabilityChange: (@MainActor (Bool) -> Void)?

    func publish(actions: ReviewKeyboardActions?, from publisher: AnyObject) {
        let wasAvailable = self.actions != nil
        self.publisher = publisher
        self.actions = actions
        if wasAvailable != (actions != nil) {
            self.onAvailabilityChange?(actions != nil)
        }
    }

    /// Only the last publisher clears, so a replaced Review cannot turn off its successor's keys.
    func withdraw(from publisher: AnyObject) {
        guard self.publisher === publisher else { return }
        self.publish(actions: nil, from: publisher)
        self.publisher = nil
    }
}

extension EnvironmentValues {
    @Entry var reviewKeyCommandTarget: ReviewKeyCommandTarget? = nil
}

extension FocusedValues {
    @Entry var reviewKeyCommandTarget: ReviewKeyCommandTarget?
}

func reviewRatingKey(_ rating: ReviewRating) -> String {
    String(rating.rawValue + 1)
}

/// On iPad and Mac, hosts the window's content in `ReviewKeyCommandController`, because SwiftUI
/// `keyboardShortcut` cannot give Review keys priority over focus and text editing.
struct ReviewKeyCommandOwner<Content: View>: View {
    private let content: Content
    @State private var target: ReviewKeyCommandTarget = ReviewKeyCommandTarget()

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        // Review keyboard shortcuts exist only on the iPad idiom, which Mac Catalyst uses.
        if UIDevice.current.userInterfaceIdiom == .pad {
            ReviewKeyCommandHost(target: self.target, content: self.content)
                .ignoresSafeArea()
                .focusedSceneValue(\.reviewKeyCommandTarget, self.target)
        } else {
            self.content
        }
    }
}

private struct ReviewKeyCommandHost<Content: View>: UIViewControllerRepresentable {
    let target: ReviewKeyCommandTarget
    let content: Content

    func makeUIViewController(context: Context) -> ReviewKeyCommandController {
        let controller = ReviewKeyCommandController(rootView: self.rootView(context: context))
        controller.target = self.target
        self.target.onAvailabilityChange = { [weak controller] isAvailable in
            // Availability changes during SwiftUI updates, so the responder change waits for the next turn.
            DispatchQueue.main.async {
                if isAvailable {
                    controller?.claimKeyboardIfUnowned()
                } else {
                    controller?.releaseKeyboard()
                }
            }
        }
        return controller
    }

    func updateUIViewController(_ controller: ReviewKeyCommandController, context: Context) {
        controller.rootView = self.rootView(context: context)
    }

    /// The child hosting controller does not inherit this environment, so it is passed in whole.
    private func rootView(context: Context) -> AnyView {
        var environment = context.environment
        environment.reviewKeyCommandTarget = self.target
        return AnyView(self.content.environment(\.self, environment))
    }
}

/// Every view of its window that can hold keyboard focus, including the tab sidebar and the AI
/// companion pane, descends from this controller's view, so UIKit finds these commands in the
/// responder chain and delivers their actions here wherever focus is.
private final class ReviewKeyCommandController: UIHostingController<AnyView> {
    var target: ReviewKeyCommandTarget?

    private lazy var revealCommands: [UIKeyCommand] = {
        let keys: [(input: String, modifierFlags: UIKeyModifierFlags)] = [
            (" ", []), ("\r", []), ("\u{3}", []), ("\r", .numericPad), ("\u{3}", .numericPad)
        ]
        return keys.map { key in
            reviewPriorityKeyCommand(input: key.input, modifierFlags: key.modifierFlags, action: #selector(self.revealAnswer(_:)))
        }
    }()

    private lazy var ratingCommands: [UIKeyCommand] = ReviewRating.allCases.map { rating in
        reviewPriorityKeyCommand(input: reviewRatingKey(rating), modifierFlags: [], action: self.rateAction(rating))
    }

    override var canBecomeFirstResponder: Bool { true }

    override var keyCommands: [UIKeyCommand]? {
        let inheritedCommands = super.keyCommands ?? []
        guard let actions = self.target?.actions else { return inheritedCommands }
        return inheritedCommands
            + (actions.revealAnswer == nil ? [] : self.revealCommands)
            + (actions.rate == nil ? [] : self.ratingCommands)
    }

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(self.revealAnswer(_:)) {
            return self.target?.actions?.revealAnswer != nil
        }
        if ReviewRating.allCases.contains(where: { self.rateAction($0) == action }) {
            return self.target?.actions?.rate != nil
        }
        return super.canPerformAction(action, withSender: sender)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(self.windowDidBecomeKey(_:)),
            name: UIWindow.didBecomeKeyNotification,
            object: nil
        )
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        self.claimKeyboardIfUnowned()
    }

    /// With no first responder, or one above this controller, key commands would skip this
    /// controller; a first responder at or inside its view already reaches these commands, so it keeps focus.
    func claimKeyboardIfUnowned() {
        guard self.target?.actions != nil, self.isFirstResponder == false,
              let view = self.viewIfLoaded, let window = view.window else { return }
        if let responder = firstResponderView(in: window), responder === view || view.isDescendant(of: responder) == false {
            return
        }
        _ = self.becomeFirstResponder()
    }

    /// Outside Review this controller gives up first responder, so other screens keep their usual key handling.
    func releaseKeyboard() {
        guard self.isFirstResponder else { return }
        _ = self.resignFirstResponder()
    }

    @objc private func windowDidBecomeKey(_ notification: Notification) {
        guard let window = notification.object as? UIWindow, window === self.viewIfLoaded?.window else { return }
        // Runs after the system settles the new key window's first responder.
        DispatchQueue.main.async { [weak self] in
            self?.claimKeyboardIfUnowned()
        }
    }

    private func rateAction(_ rating: ReviewRating) -> Selector {
        switch rating {
        case .again: #selector(self.rateAgain(_:))
        case .hard: #selector(self.rateHard(_:))
        case .good: #selector(self.rateGood(_:))
        case .easy: #selector(self.rateEasy(_:))
        }
    }

    @objc private func revealAnswer(_ command: UIKeyCommand) { self.target?.actions?.revealAnswer?() }
    @objc private func rateAgain(_ command: UIKeyCommand) { self.target?.actions?.rate?(.again) }
    @objc private func rateHard(_ command: UIKeyCommand) { self.target?.actions?.rate?(.hard) }
    @objc private func rateGood(_ command: UIKeyCommand) { self.target?.actions?.rate?(.good) }
    @objc private func rateEasy(_ command: UIKeyCommand) { self.target?.actions?.rate?(.easy) }
}

/// Untitled, so the command stays out of the menu and the iPad shortcut overlay, which the Review menu fills.
@MainActor
private func reviewPriorityKeyCommand(input: String, modifierFlags: UIKeyModifierFlags, action: Selector) -> UIKeyCommand {
    let command = UIKeyCommand(input: input, modifierFlags: modifierFlags, action: action)
    command.wantsPriorityOverSystemBehavior = true
    return command
}

@MainActor
private func firstResponderView(in view: UIView) -> UIView? {
    if view.isFirstResponder { return view }
    return view.subviews.lazy.compactMap { firstResponderView(in: $0) }.first
}

extension View {
    /// Publishes this Review's key actions to its window's `ReviewKeyCommandTarget`; nil turns the keys off.
    func reviewKeyCommandActions(_ actions: ReviewKeyboardActions?) -> some View {
        self.background {
            ReviewKeyCommandPublisher(actions: actions)
        }
    }
}

private struct ReviewKeyCommandPublisher: UIViewRepresentable {
    let actions: ReviewKeyboardActions?

    func makeUIView(context: Context) -> PublisherView {
        let view = PublisherView()
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ view: PublisherView, context: Context) {
        view.target = context.environment.reviewKeyCommandTarget
        view.target?.publish(actions: self.actions, from: view)
    }

    static func dismantleUIView(_ view: PublisherView, coordinator: Void) {
        view.target?.withdraw(from: view)
    }

    final class PublisherView: UIView {
        weak var target: ReviewKeyCommandTarget?
    }
}
