import SwiftUI

private struct PendingReviewAnimationsSelection {
    let requestId: UUID
    let identityKey: String?
    let isEnabled: Bool
}

struct ReviewAnimationsSettingsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(PremiumPresenter.self) private var premiumPresenter: PremiumPresenter

    @State private var pendingIsEnabled: Bool? = nil
    @State private var pendingSelection: PendingReviewAnimationsSelection? = nil
    @State private var guidanceMessage: String = ""

    var body: some View {
        List {
            if self.store.canCustomizeStyle == false {
                Section {
                    Text(aiSettingsLocalized(
                        "settings.reviewAnimations.premiumNote",
                        "Turning off review animations is available with Premium. Your saved setting returns when Premium is active."
                    ))
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier(UITestIdentifier.reviewAnimationsPremiumNote)
                }
            }

            Section {
                if self.guidanceMessage.isEmpty == false {
                    Text(self.guidanceMessage)
                        .foregroundStyle(.secondary)
                }

                Toggle(
                    aiSettingsLocalized(
                        "settings.reviewAnimations.toggle",
                        "Show animations after rating a card"
                    ),
                    isOn: Binding(
                        get: {
                            self.pendingIsEnabled ?? store.effectiveReviewReactionAnimationsEnabled
                        },
                        set: { isEnabled in
                            self.selectReviewAnimationsEnabled(isEnabled: isEnabled)
                        }
                    )
                )
                .disabled(self.pendingIsEnabled != nil || store.canPersistAccountPreferences == false)
                .accessibilityIdentifier(UITestIdentifier.reviewAnimationsSettingsToggle)
            } footer: {
                Text(
                    aiSettingsLocalized(
                        "settings.reviewAnimations.lowPowerMode.footer",
                        "Low Power Mode temporarily disables review animations without changing this setting."
                    )
                )
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.reviewAnimationsSettingsScreen)
        .navigationTitle(aiSettingsLocalized("settings.reviewAnimations.title", "Review Animations"))
        .task {
            await self.refreshCloudAccountContext()
        }
        .onChange(of: self.store.accountPreferencesIdentityKey) { _, _ in
            self.pendingSelection = nil
        }
        .onChange(of: self.premiumPresenter.result) { _, result in
            guard let pending = self.pendingSelection, let result,
                  result.requestId == pending.requestId else {
                return
            }
            self.pendingSelection = nil
            if result.outcome == .accessGranted,
               pending.identityKey == self.store.accountPreferencesIdentityKey,
               self.store.canCustomizeStyle {
                self.selectReviewAnimationsEnabled(isEnabled: pending.isEnabled)
            }
        }
        .onDisappear {
            self.pendingSelection = nil
        }
    }

    private func selectReviewAnimationsEnabled(isEnabled: Bool) {
        if isEnabled == false && self.store.canCustomizeStyle == false {
            guard self.pendingSelection == nil else { return }
            let requestId = self.premiumPresenter.present(
                reason: .premiumFeature(requiredTierRank: premiumTierRank),
                analyticsEntryPoint: .reviewAnimations,
                entitlement: self.store.cloudEntitlement,
                identity: try? self.store.appleSubscriptionIdentity()
            )
            self.pendingSelection = PendingReviewAnimationsSelection(
                requestId: requestId,
                identityKey: self.store.accountPreferencesIdentityKey,
                isEnabled: isEnabled
            )
            return
        }
        self.updateReviewAnimationsEnabled(isEnabled: isEnabled)
    }

    private func updateReviewAnimationsEnabled(isEnabled: Bool) {
        guard self.pendingIsEnabled == nil else {
            return
        }
        self.pendingIsEnabled = isEnabled

        Task { @MainActor in
            defer {
                self.pendingIsEnabled = nil
            }

            do {
                try await store.updateReviewReactionAnimationsEnabled(isEnabled: isEnabled)
                self.guidanceMessage = ""
            } catch {
                self.handleReviewAnimationsFailure(error: error)
            }
        }
    }

    private func refreshCloudAccountContext() async {
        do {
            try await store.refreshCloudAccountContextIfActive()
            self.guidanceMessage = ""
        } catch {
            self.handleReviewAnimationsFailure(error: error)
        }
    }

    private func handleReviewAnimationsFailure(error: Error) {
        if isRequestCancellationError(error: error) {
            return
        }
        if isRetryableNetworkTransportFailure(error: error) {
            self.guidanceMessage = aiSettingsLocalized("settings.sync.failed.generic", "Sync failed")
            return
        }
        if let guidanceMessage = self.store.blockedCloudIdentityConflictMessage(error: error) {
            self.guidanceMessage = guidanceMessage
            return
        }

        self.store.presentTechnicalError(error)
    }
}

#Preview {
    NavigationStack {
        ReviewAnimationsSettingsView()
            .environment(FlashcardsStore())
            .environment(PremiumPresenter())
    }
}
