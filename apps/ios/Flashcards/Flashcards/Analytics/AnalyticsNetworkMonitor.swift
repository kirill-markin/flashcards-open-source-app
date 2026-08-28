import Foundation
import Network

/**
 * Latest connectivity reading, kept so `track` can stamp `networkState` on the event synchronously at
 * the moment it happens. The value has to be readable without awaiting anything: it is captured on
 * the interaction path, and the contract makes it a per-event field precisely so an event created
 * while offline still says so once the queue drains.
 *
 * Path changes also drive the connectivity-restored flush trigger.
 */
final class AnalyticsNetworkMonitor: @unchecked Sendable {
    private let lock: NSLock
    private let monitor: NWPathMonitor
    private let monitorQueue: DispatchQueue
    private var state: AnalyticsNetworkState
    /// Only the start-once claim. Deliberately not named for the monitor being *running*: it is set
    /// before `monitor.start` so two concurrent calls cannot both start the monitor, which means it is
    /// never an observation of connectivity and nothing outside `start` may read it as one.
    private var hasRequestedStart: Bool

    init() {
        self.lock = NSLock()
        self.monitor = NWPathMonitor()
        self.monitorQueue = DispatchQueue(label: "com.flashcards.analytics.network-monitor")
        self.state = .unknown
        self.hasRequestedStart = false
    }

    func start(onConnectivityRestored: @escaping @Sendable () -> Void) {
        self.lock.lock()
        let hadRequestedStart = self.hasRequestedStart
        self.hasRequestedStart = true
        self.lock.unlock()
        guard hadRequestedStart == false else {
            return
        }

        self.monitor.pathUpdateHandler = { [weak self] path in
            guard let self else {
                return
            }

            let nextState = analyticsNetworkState(path: path)
            self.lock.lock()
            let previousState = self.state
            self.state = nextState
            self.lock.unlock()

            if previousState == .offline && nextState != .offline {
                onConnectivityRestored()
            }
        }
        self.monitor.start(queue: self.monitorQueue)
    }

    /**
     * The last state `pathUpdateHandler` actually delivered, and `unknown` until the first one does.
     *
     * Nothing is read from the monitor to fill that gap. `Network.framework` publishes no synchronous
     * path accessor: the first update is delivered asynchronously on `monitorQueue`, and the Swift
     * overlay's `currentPath` is a cached snapshot holding its pre-update default until then — an
     * unsatisfied path, which maps to `offline`. The gap is guaranteed rather than theoretical,
     * because `FlashcardsApp.init` starts this monitor and emits the cold `app_opened` on the next
     * statement of the same main-thread `init`, ahead of any queue hop. Seeding from `currentPath`
     * would therefore stamp `offline` on the two highest-volume events of every online device,
     * permanently, on an append-only table.
     *
     * The contract forbids exactly that: never synthesise `offline` from a state that was not
     * observed. `unknown` is a legal value and an honest gap; `offline` is the one value the field
     * exists to carry, and a false one poisons the analysis the field was added for.
     */
    func currentState() -> AnalyticsNetworkState {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        return self.state
    }
}

private func analyticsNetworkState(path: NWPath) -> AnalyticsNetworkState {
    guard path.status == .satisfied else {
        return .offline
    }
    if path.usesInterfaceType(.wifi) || path.usesInterfaceType(.wiredEthernet) {
        return .wifi
    }
    if path.usesInterfaceType(.cellular) {
        return .cellular
    }

    return .unknown
}
