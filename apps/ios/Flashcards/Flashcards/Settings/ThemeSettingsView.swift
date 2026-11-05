import SwiftUI

func themeSettingsTitle() -> String {
    aiSettingsLocalized("settings.theme.title", "Theme")
}

private struct PendingThemeSelection {
    let requestId: UUID
    let identityKey: String?
    let theme: AccountTheme
}

struct ThemeSettingsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(PremiumPresenter.self) private var premiumPresenter: PremiumPresenter

    @State private var pendingTheme: AccountTheme? = nil
    @State private var pendingSelection: PendingThemeSelection? = nil
    @State private var guidanceMessage: String = ""
    @State private var isPreparingAccount: Bool = true
    @State private var accountPreparationError: String?
    @State private var accountPreparationAttempt: Int = 0

    private var isUnavailable: Bool {
        self.isPreparingAccount || self.store.canPersistAccountPreferences == false
    }

    var body: some View {
        List {
            if self.store.canCustomizeStyle == false {
                Section {
                    Text(aiSettingsLocalized(
                        "settings.theme.premiumNote",
                        "The light theme is available with Premium. Your saved theme returns when Premium is active."
                    ))
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier(UITestIdentifier.themePremiumNote)
                }
            }

            Section {
                if self.guidanceMessage.isEmpty == false {
                    Text(self.guidanceMessage)
                        .foregroundStyle(.secondary)
                }

                ForEach(AccountTheme.allCases) { theme in
                    Button {
                        self.selectTheme(theme: theme)
                    } label: {
                        HStack {
                            Text(theme.title)
                                .foregroundStyle(Color.primary)
                            Spacer()
                            if self.pendingTheme == theme {
                                ProgressView()
                            } else if self.store.effectiveAccountTheme == theme {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(.tint)
                            }
                        }
                    }
                    .accessibilityAddTraits(self.store.effectiveAccountTheme == theme ? [.isSelected] : [])
                    .accessibilityIdentifier(UITestIdentifier.themeOptionPrefix + theme.rawValue)
                }
            }
            .disabled(self.pendingTheme != nil || self.isUnavailable)

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
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.themeSettingsScreen)
        .nativeNavigationTitle(themeSettingsTitle())
        .task(id: self.accountPreparationAttempt) {
            self.isPreparingAccount = true
            self.accountPreparationError = nil
            do {
                _ = try await self.store.prepareAppleSubscriptionIdentity()
                self.isPreparingAccount = false
            } catch {
                self.isPreparingAccount = false
                guard Task.isCancelled == false, isRequestCancellationError(error: error) == false else { return }
                self.accountPreparationError = aiSettingsLocalized("premium.apple.loadFailed", "Could not load the App Store offer. Check your connection and retry.") + "\n" + error.localizedDescription
                return
            }
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
                self.selectTheme(theme: pending.theme)
            }
        }
        .onDisappear {
            self.pendingSelection = nil
        }
    }

    private func selectTheme(theme: AccountTheme) {
        guard self.isUnavailable == false else { return }
        if self.store.canCustomizeStyle == false {
            // Writing Dark here would overwrite the retained premium selection that resubscription restores.
            guard theme != .defaultTheme else { return }
            guard self.pendingSelection == nil else { return }
            let requestId = self.premiumPresenter.present(
                reason: .premiumFeature(requiredTierRank: premiumTierRank),
                analyticsEntryPoint: .theme,
                entitlement: self.store.cloudEntitlement,
                identity: try? self.store.appleSubscriptionIdentity()
            )
            self.pendingSelection = PendingThemeSelection(
                requestId: requestId,
                identityKey: self.store.accountPreferencesIdentityKey,
                theme: theme
            )
            return
        }
        guard theme != self.store.effectiveAccountTheme else { return }
        self.updateTheme(theme: theme)
    }

    private func updateTheme(theme: AccountTheme) {
        guard self.pendingTheme == nil else {
            return
        }
        self.pendingTheme = theme

        Task { @MainActor in
            defer {
                self.pendingTheme = nil
            }

            do {
                try await self.store.updateTheme(theme)
                self.guidanceMessage = ""
            } catch {
                self.handleThemeFailure(error: error)
            }
        }
    }

    private func refreshCloudAccountContext() async {
        do {
            try await self.store.refreshCloudAccountContextIfActive()
            self.guidanceMessage = ""
        } catch {
            self.handleThemeFailure(error: error)
        }
    }

    private func handleThemeFailure(error: Error) {
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
        ThemeSettingsView()
            .environment(FlashcardsStore())
            .environment(PremiumPresenter())
    }
}
