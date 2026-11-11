import SwiftUI

@main
struct FlashcardsWatchApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @State private var session: WatchSessionModel

    @MainActor
    init() {
        FlashcardsObservability.configure(bundle: .main, processInfo: ProcessInfo.processInfo)
        AutomationRun.logDecision()
        // Started before the first sync so the installation marker reaches the server with it.
        TestDistribution.startResolution()
        Analytics.setEnabled(ProductAnalyticsPreference.effectiveIsEnabled(userDefaults: .standard))
        let session = WatchSessionModel()
        if AutomationRun.current.isAutomation == false {
            Analytics.configure(
                credentialsProvider: { [weak session] in
                    session?.analyticsCredentials()
                },
                // The watch is signed in only through the iPhone and never creates a guest identity.
                guestCredentialMinter: {
                    .skipped
                }
            )
            Analytics.track(.appOpened(launchType: .cold))
        }
        session.activateConnectivity()
        self._session = State(initialValue: session)
    }

    var body: some Scene {
        WindowGroup {
            WatchRootView(session: self.session)
        }
        .onChange(of: self.scenePhase, initial: true) { _, newPhase in
            guard newPhase == .active else {
                return
            }
            Task {
                await self.session.refreshFromIPhone()
            }
        }
    }
}
