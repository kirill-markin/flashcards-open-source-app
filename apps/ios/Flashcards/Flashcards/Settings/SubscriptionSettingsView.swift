import SwiftUI

private struct CloudEntitlementEndPresentation: Equatable {
    let title: String
    let value: String
}

private func makeCloudEntitlementEndPresentation(entitlement: CloudEntitlement) -> CloudEntitlementEndPresentation? {
    switch entitlement.status {
    case .noEntitlement:
        return nil
    case .active:
        guard let until = entitlement.until else {
            return CloudEntitlementEndPresentation(
                title: aiSettingsLocalized("settings.subscription.ends", "Ends"),
                value: aiSettingsLocalized("settings.subscription.noEndDate", "No end date")
            )
        }

        return CloudEntitlementEndPresentation(
            title: entitlement.willRenew
                ? aiSettingsLocalized("settings.subscription.renews", "Renews")
                : aiSettingsLocalized("settings.subscription.ends", "Ends"),
            value: until.formatted(date: .long, time: .omitted)
        )
    case .inGrace:
        return CloudEntitlementEndPresentation(
            title: aiSettingsLocalized("settings.subscription.graceEnds", "Grace period ends"),
            value: entitlement.until?.formatted(date: .long, time: .omitted)
                ?? aiSettingsLocalized("settings.subscription.endUnknown", "Unknown")
        )
    }
}

private func localizedCloudEntitlementStatusTitle(entitlement: CloudEntitlement) -> String {
    switch entitlement.status {
    case .noEntitlement:
        return aiSettingsLocalized("settings.subscription.status.none", "No subscription")
    case .active:
        return entitlement.isTrial
            ? aiSettingsLocalized("settings.subscription.status.trial", "Free trial")
            : aiSettingsLocalized("settings.subscription.status.active", "Active")
    case .inGrace:
        return aiSettingsLocalized("settings.subscription.status.inGrace", "Grace period")
    }
}

struct SubscriptionSettingsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(AppleSubscriptionService.self) private var subscriptions: AppleSubscriptionService
    @Environment(PremiumPresenter.self) private var premiumPresenter: PremiumPresenter

    @State private var isPreparingAccount: Bool = true
    @State private var accountPreparationError: String?
    @State private var accountPreparationAttempt: Int = 0

    var body: some View {
        List {
            Section {
                if let entitlement = store.cloudEntitlement {
                    LabeledContent(aiSettingsLocalized("settings.subscription.plan", "Plan")) {
                        Text(entitlement.tierDisplayName)
                    }

                    LabeledContent(aiSettingsLocalized("settings.subscription.status", "Status")) {
                        Text(localizedCloudEntitlementStatusTitle(entitlement: entitlement))
                    }

                    if let endPresentation = makeCloudEntitlementEndPresentation(entitlement: entitlement) {
                        LabeledContent(endPresentation.title) {
                            Text(endPresentation.value)
                        }
                    }
                } else {
                    Text(
                        aiSettingsLocalized(
                            "settings.subscription.planUnknown",
                            "Your plan appears here after the app syncs with your account."
                        )
                    )
                    .foregroundStyle(.secondary)
                }

                if hasPremiumAccess(entitlement: store.cloudEntitlement) == false {
                    Button(aiSettingsLocalized("settings.subscription.change", "Change subscription")) {
                        self.premiumPresenter.present(
                            reason: .premiumFeature(requiredTierRank: premiumTierRank),
                            analyticsEntryPoint: .subscriptionSettings,
                            entitlement: store.cloudEntitlement,
                            identity: try? store.appleSubscriptionIdentity()
                        )
                    }
                    .disabled(self.isPreparingAccount || (try? store.appleSubscriptionIdentity()) == nil)
                    .accessibilityIdentifier(UITestIdentifier.subscriptionSettingsPremiumButton)
                }
            }

            if self.isPreparingAccount {
                Section {
                    ProgressView(aiSettingsLocalized("common.loading", "Loading..."))
                }
            }
            if let accountPreparationError {
                Section {
                    Text(accountPreparationError).foregroundStyle(.red)
                    Button(aiSettingsLocalized("common.retry", "Retry")) {
                        self.accountPreparationAttempt += 1
                    }
                    .disabled(self.isPreparingAccount)
                }
            }

            if let errorMessage = self.subscriptions.runtimeErrorMessage {
                Section {
                    Text(aiSettingsLocalized("premium.apple.failed", "Purchase could not be confirmed. Restore purchases to retry without buying again.") + "\n" + errorMessage)
                        .foregroundStyle(.red)
                        .accessibilityIdentifier(UITestIdentifier.subscriptionSettingsMessage)
                }
            }

            AppleSubscriptionControls(
                summaryEndDate: self.store.cloudEntitlement?.status == .active ? self.store.cloudEntitlement?.until : nil,
                isRestoreDisabled: self.isPreparingAccount || (try? store.appleSubscriptionIdentity()) == nil,
                onRestore: {}
            )
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.subscriptionSettingsScreen)
        .navigationTitle(aiSettingsLocalized("settings.subscription.title", "Subscription"))
        .task(id: self.accountPreparationAttempt) {
            self.isPreparingAccount = true
            self.accountPreparationError = nil
            defer { self.isPreparingAccount = false }
            do {
                _ = try await self.store.prepareAppleSubscriptionIdentity()
            } catch {
                guard Task.isCancelled == false, isRequestCancellationError(error: error) == false else { return }
                self.accountPreparationError = aiSettingsLocalized("premium.apple.loadFailed", "Could not load the App Store offer. Check your connection and retry.") + "\n" + error.localizedDescription
            }
        }
    }

}

#Preview {
    let store = FlashcardsStore()
    NavigationStack {
        SubscriptionSettingsView()
            .environment(store)
            .environment(AppleSubscriptionService(store: store, session: .shared))
            .environment(PremiumPresenter())
    }
}
