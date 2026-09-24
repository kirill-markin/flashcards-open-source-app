import SwiftUI

struct ProductAnalyticsSettingsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    @State private var isSaving: Bool = false
    @State private var guidanceMessage: String = ""

    var body: some View {
        List {
            Section {
                if self.guidanceMessage.isEmpty == false {
                    Text(self.guidanceMessage)
                        .foregroundStyle(.secondary)
                }

                Toggle(
                    aiSettingsLocalized(
                        "settings.productAnalytics.toggle",
                        "Share product analytics"
                    ),
                    isOn: Binding(
                        get: {
                            store.isProductAnalyticsEnabled
                        },
                        set: { isEnabled in
                            self.updateProductAnalyticsEnabled(isEnabled: isEnabled)
                        }
                    )
                )
                .disabled(self.isSaving)
                .accessibilityIdentifier(UITestIdentifier.productAnalyticsSettingsToggle)
            } footer: {
                Text(
                    aiSettingsLocalized(
                        "settings.productAnalytics.footer",
                        "Product analytics tell us which parts of the app people use, never what is on your cards. When this is off, the app records and sends nothing. Crash and error reports are not affected."
                    )
                )
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.productAnalyticsSettingsScreen)
        .navigationTitle(aiSettingsLocalized("settings.productAnalytics.title", "Product Analytics"))
        .task {
            await self.refreshCloudAccountContext()
        }
    }

    private func updateProductAnalyticsEnabled(isEnabled: Bool) {
        guard self.isSaving == false else {
            return
        }
        // Set here rather than inside the task: `.disabled` only engages on the next render, so two
        // quick taps would both pass the guard and send two PATCHes with no ordering guarantee,
        // leaving the server holding the opposite of the final choice.
        self.isSaving = true

        Task { @MainActor in
            defer {
                self.isSaving = false
            }

            do {
                try await store.updateProductAnalyticsEnabled(isEnabled: isEnabled)
                self.guidanceMessage = ""
            } catch {
                self.handleProductAnalyticsFailure(error: error)
            }
        }
    }

    private func refreshCloudAccountContext() async {
        do {
            try await store.refreshCloudAccountContextIfActive()
            self.guidanceMessage = ""
        } catch {
            self.handleProductAnalyticsFailure(error: error)
        }
    }

    private func handleProductAnalyticsFailure(error: Error) {
        // Classified on the unwrapped error, presented on the wrapped one. What arrives wrapped is a
        // failure the push reporter really did capture: a Keychain load failure, a
        // `carrier_unavailable` answer no credential could carry, or any other non-transport push
        // failure. That wrapper is a bridged Swift struct and not the failure itself, and
        // `blockedCloudIdentityConflictMessage` classifies with an `as?` cast, which never follows a
        // wrapper — so unwrapping is the only way it can see the shape underneath and answer about it
        // at all. An ordinary offline opt-out is not one of these: the reporter filters transport
        // failures ahead of its dedupe and returns false, so every caller hands those back
        // unwrapped, and the transport filter below — not this unwrap — is what keeps them on the
        // soft inline line. Presenting the still-wrapped error is what keeps the captured marker
        // intact, so a failure already reported once is not reported to Sentry a second time on
        // presentation.
        let classifiedError = technicalErrorPresentationSource(error: error)
        if isRequestCancellationError(error: classifiedError) {
            return
        }
        // The same filter the push reporter uses to decide a failure says nothing but "the network",
        // and deliberately the wider one: a captive portal or a TLS-intercepting network fails with
        // `secureConnectionFailed` or a certificate code, which is never captured and so must never
        // reach the technical dialog either. The two agreeing is what keeps every failure on this
        // screen either softly explained or recorded in Sentry.
        if isSilentlyIgnorableNetworkTransportFailure(error: classifiedError) {
            // The switch itself already took effect locally, so this reports the account copy
            // lagging behind, not a refused choice.
            self.guidanceMessage = aiSettingsLocalized("settings.sync.failed.generic", "Sync failed")
            return
        }
        if let guidanceMessage = self.store.blockedCloudIdentityConflictMessage(error: classifiedError) {
            self.guidanceMessage = guidanceMessage
            return
        }

        self.store.presentTechnicalError(error)
    }
}

#Preview {
    NavigationStack {
        ProductAnalyticsSettingsView()
            .environment(FlashcardsStore())
    }
}
