import Foundation
import UIKit

@MainActor
final class CloudGoogleAuthDiagnostics {
    private let diagnosticId = UUID()
    private let startedAt = ContinuousClock.now
    private weak var presenter: UIViewController?
    private weak var window: UIWindow?
    private var observers: [NSObjectProtocol] = []
    private var sdkCallbackReceived = false

    init(presentation: CloudNativeAuthPresentation) {
        self.presenter = presentation.viewController
        self.window = presentation.window
        let lifecycle: [(Notification.Name, GoogleAuthorizationAction)] = [
            (UIApplication.willResignActiveNotification, .willResignActive),
            (UIApplication.didEnterBackgroundNotification, .didEnterBackground),
            (UIApplication.willEnterForegroundNotification, .willEnterForeground),
            (UIApplication.didBecomeActiveNotification, .didBecomeActive)
        ]
        self.observers = lifecycle.map { name, action in
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated {
                    guard let self, !self.sdkCallbackReceived else { return }
                    self.record(action: action)
                }
            }
        }
    }

    func complete(outcome: GoogleAuthorizationOutcome, error: NSError?) {
        self.sdkCallbackReceived = true
        self.record(action: .sdkCallback, outcome: outcome, error: error)
        self.stopObserving()
    }

    func stopObserving() {
        for observer in self.observers {
            NotificationCenter.default.removeObserver(observer)
        }
        self.observers.removeAll()
    }

    func record(action: GoogleAuthorizationAction) {
        self.record(action: action, outcome: nil, error: nil)
    }

    private func record(action: GoogleAuthorizationAction, outcome: GoogleAuthorizationOutcome?, error: NSError?) {
        let elapsed = self.startedAt.duration(to: .now).components
        FlashcardsObservability.addBreadcrumb(.googleAuthorization(GoogleAuthorizationObservation(
            action: action,
            diagnosticId: self.diagnosticId,
            elapsedMilliseconds: elapsed.seconds * 1_000 + elapsed.attoseconds / 1_000_000_000_000_000,
            sdkCallbackReceived: self.sdkCallbackReceived,
            outcome: outcome,
            errorDomain: error.map { safeDiagnosticIdentifier($0.domain) },
            errorCode: error?.code,
            applicationState: UIApplication.shared.applicationState.rawValue,
            sceneActivationState: self.window?.windowScene?.activationState.rawValue,
            presenterAttachedToWindow: self.window != nil && self.presenter?.viewIfLoaded?.window === self.window,
            windowHidden: self.window?.isHidden,
            windowKey: self.window?.isKeyWindow,
            hasPresentedController: self.presenter?.presentedViewController != nil,
            presenterBeingPresented: self.presenter?.isBeingPresented ?? false,
            presenterBeingDismissed: self.presenter?.isBeingDismissed ?? false
        )))
    }
}
