import SwiftUI

func appIconSettingsTitle() -> String {
    aiSettingsLocalized("settings.appIcon.title", "App Icon")
}

private struct PendingAppIconSelection {
    let requestId: UUID
    let identityKey: String?
    let option: AppIconOption
}

struct AppIconSettingsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(PremiumPresenter.self) private var premiumPresenter: PremiumPresenter

    @State private var pendingSelection: PendingAppIconSelection? = nil

    var body: some View {
        List {
            if self.store.canCustomizeStyle == false {
                Section {
                    Text(aiSettingsLocalized(
                        "settings.appIcon.premiumNote",
                        "Changing the app icon is available with Premium. Your saved icon returns when Premium is active."
                    ))
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier(UITestIdentifier.appIconPremiumNote)
                }
            }

            Section {
                ForEach(AppIconOption.allCases) { option in
                    Button {
                        self.selectAppIcon(option: option)
                    } label: {
                        HStack(spacing: 12) {
                            Image(option.previewImageName)
                                .resizable()
                                .scaledToFit()
                                .frame(width: 40, height: 40)
                                .accessibilityHidden(true)
                            Text(option.title)
                                .foregroundStyle(Color.primary)
                            Spacer()
                            if self.store.effectiveAppIcon == option {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(.tint)
                            }
                        }
                    }
                    .accessibilityAddTraits(self.store.effectiveAppIcon == option ? [.isSelected] : [])
                    .accessibilityIdentifier(UITestIdentifier.appIconOptionPrefix + option.rawValue)
                }
            } footer: {
                Text(aiSettingsLocalized(
                    "settings.appIcon.systemAlertNote",
                    "iOS confirms each icon change with an alert."
                ))
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.appIconSettingsScreen)
        .navigationTitle(appIconSettingsTitle())
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
                self.selectAppIcon(option: pending.option)
            }
        }
        .onDisappear {
            self.pendingSelection = nil
        }
    }

    private func selectAppIcon(option: AppIconOption) {
        if self.store.canCustomizeStyle == false {
            // Writing Default here would overwrite the retained premium selection that resubscription restores.
            guard option != .default else { return }
            guard self.pendingSelection == nil else { return }
            let requestId = self.premiumPresenter.present(
                reason: .premiumFeature(requiredTierRank: premiumTierRank),
                analyticsEntryPoint: .appIcon,
                entitlement: self.store.cloudEntitlement,
                identity: try? self.store.appleSubscriptionIdentity()
            )
            self.pendingSelection = PendingAppIconSelection(
                requestId: requestId,
                identityKey: self.store.accountPreferencesIdentityKey,
                option: option
            )
            return
        }
        do {
            try self.store.updateAppIconSelection(option: option)
        } catch {
            self.store.presentTechnicalError(error)
        }
    }
}

#Preview {
    NavigationStack {
        AppIconSettingsView()
            .environment(FlashcardsStore())
            .environment(PremiumPresenter())
    }
}
