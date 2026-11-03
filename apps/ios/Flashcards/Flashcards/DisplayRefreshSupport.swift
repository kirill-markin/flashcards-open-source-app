import QuartzCore

/// Runs `action` once at the next display refresh, so work scheduled from a tap or a SwiftUI update runs after
/// that update's frame is committed. `DispatchQueue.main.async` can still run before the commit.
@MainActor
func performOnNextDisplayRefresh(_ action: @escaping @MainActor () -> Void) {
    let target = DisplayRefreshActionTarget(action: action)
    let displayLink = CADisplayLink(target: target, selector: #selector(DisplayRefreshActionTarget.displayDidRefresh(_:)))
    displayLink.add(to: .main, forMode: .common)
}

/// The display link retains this target until `invalidate()`.
@MainActor
private final class DisplayRefreshActionTarget: NSObject {
    private let action: @MainActor () -> Void

    init(action: @escaping @MainActor () -> Void) {
        self.action = action
    }

    @objc func displayDidRefresh(_ displayLink: CADisplayLink) {
        displayLink.invalidate()
        self.action()
    }
}
