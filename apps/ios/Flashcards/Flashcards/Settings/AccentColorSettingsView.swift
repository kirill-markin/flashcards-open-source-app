import SwiftUI

func accentColorSettingsTitle() -> String {
    aiSettingsLocalized("settings.accentColor.title", "Accent color")
}

private struct AccentColorPreset: Identifiable {
    let name: String
    let color: AccountAccentColor

    var id: String { self.color.hex }
}

private struct PendingAccentColorSelection {
    let requestId: UUID
    let identityKey: String?
    let color: AccountAccentColor
}

private func accentColorPresets() -> [AccentColorPreset] {
    [
        AccentColorPreset(name: aiSettingsLocalized("settings.accentColor.default", "Default"), color: .defaultColor),
        AccentColorPreset(name: aiSettingsLocalized("settings.accentColor.blue", "Blue"), color: AccountAccentColor(rgb: 0x4D8DFF)),
        AccentColorPreset(name: aiSettingsLocalized("settings.accentColor.purple", "Purple"), color: AccountAccentColor(rgb: 0xA78BFA)),
        AccentColorPreset(name: aiSettingsLocalized("settings.accentColor.pink", "Pink"), color: AccountAccentColor(rgb: 0xF472B6)),
        AccentColorPreset(name: aiSettingsLocalized("settings.accentColor.teal", "Teal"), color: AccountAccentColor(rgb: 0x2DD4BF)),
        AccentColorPreset(name: aiSettingsLocalized("settings.accentColor.gold", "Gold"), color: AccountAccentColor(rgb: 0xEAB308))
    ]
}

struct AccentColorSettingsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(PremiumPresenter.self) private var premiumPresenter: PremiumPresenter

    @State private var customColor: AccountAccentColor = .defaultColor
    @State private var hexText: String = AccountAccentColor.defaultColor.hex
    @State private var isSaving: Bool = false
    @State private var guidanceMessage: String = ""
    @State private var pendingSelection: PendingAccentColorSelection? = nil

    private var isUnavailable: Bool {
        self.isSaving || self.store.isAccountPreferencesUpdateInFlight || self.store.canPersistAccountPreferences == false
    }

    var body: some View {
        List {
            if self.store.canUseCustomAccentColor == false {
                Section {
                    Text(aiSettingsLocalized(
                        "settings.accentColor.premiumNote",
                        "Custom accent colors are available with Premium. Your saved color returns when Premium is active."
                    ))
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier(UITestIdentifier.accentColorPremiumNote)
                }
            }

            Section {
                ForEach(accentColorPresets()) { preset in
                    Button {
                        self.selectColor(preset.color)
                    } label: {
                        HStack {
                            Circle()
                                .fill(preset.color.color)
                                .frame(width: 24, height: 24)
                            Text(preset.name)
                                .foregroundStyle(.primary)
                            Spacer()
                            if self.store.effectiveAccountAccentColor == preset.color {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(.tint)
                            }
                        }
                    }
                    .accessibilityValue(preset.color.hex)
                    .accessibilityAddTraits(self.store.effectiveAccountAccentColor == preset.color ? [.isSelected] : [])
                    .accessibilityIdentifier(UITestIdentifier.accentColorPresetPrefix + preset.color.hex)
                }
            }
            .disabled(self.isUnavailable)

            Section {
                ColorPicker(
                    aiSettingsLocalized("settings.accentColor.custom", "Custom color"),
                    selection: self.customColorBinding,
                    supportsOpacity: false
                )
                .accessibilityIdentifier(UITestIdentifier.accentColorPicker)

                TextField(text: self.$hexText) {
                    Text(verbatim: "HEX (#RRGGBB)")
                }
                .font(.body.monospaced())
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .accessibilityIdentifier(UITestIdentifier.accentColorHexField)
                .onChange(of: self.hexText) { _, hex in
                    if let color = AccountAccentColor(hex: hex) {
                        self.customColor = color
                    }
                }

                Button {
                    guard let color = AccountAccentColor(hex: self.hexText) else {
                        self.guidanceMessage = aiSettingsLocalized(
                            "settings.accentColor.invalidHex",
                            "Enter a color as #RRGGBB, with six hexadecimal digits."
                        )
                        return
                    }
                    self.selectColor(color)
                } label: {
                    HStack {
                        Text(aiSettingsLocalized("common.save", "Save"))
                        Spacer()
                        if self.isSaving {
                            ProgressView()
                        }
                    }
                }
                .accessibilityIdentifier(UITestIdentifier.accentColorSaveButton)
            }
            .disabled(self.isUnavailable)

            if self.guidanceMessage.isEmpty == false {
                Section {
                    Text(self.guidanceMessage)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(accentColorSettingsTitle())
        .accessibilityIdentifier(UITestIdentifier.accentColorSettingsScreen)
        .task {
            self.resetDraft()
            do {
                try await self.store.refreshCloudAccountContextIfActive()
            } catch {
                self.handleFailure(error)
            }
        }
        .onChange(of: self.store.accountPreferences.accentColor) { _, _ in
            self.resetDraft()
        }
        .onChange(of: self.store.accountPreferencesIdentityKey) { _, _ in
            self.pendingSelection = nil
            self.guidanceMessage = ""
            self.resetDraft()
        }
        .onChange(of: self.premiumPresenter.result) { _, result in
            guard let pending = self.pendingSelection, let result,
                  result.requestId == pending.requestId else {
                return
            }
            self.pendingSelection = nil
            if result.outcome == .accessGranted,
               pending.identityKey == self.store.accountPreferencesIdentityKey,
               self.store.canUseCustomAccentColor {
                self.saveColor(pending.color)
            }
        }
        .onDisappear {
            self.pendingSelection = nil
        }
    }

    private var customColorBinding: Binding<CGColor> {
        Binding(
            get: {
                CGColor(
                    srgbRed: CGFloat((self.customColor.rgb >> 16) & 0xFF) / 255,
                    green: CGFloat((self.customColor.rgb >> 8) & 0xFF) / 255,
                    blue: CGFloat(self.customColor.rgb & 0xFF) / 255,
                    alpha: 1
                )
            },
            set: { color in
                guard let space = CGColorSpace(name: CGColorSpace.sRGB),
                      let converted = color.converted(to: space, intent: .defaultIntent, options: nil),
                      let components = converted.components, components.count == 4 else {
                    self.store.presentTechnicalError(LocalStoreError.validation("The selected color could not be converted to sRGB"))
                    return
                }
                let red = UInt32((min(1, max(0, components[0])) * 255).rounded())
                let green = UInt32((min(1, max(0, components[1])) * 255).rounded())
                let blue = UInt32((min(1, max(0, components[2])) * 255).rounded())
                self.customColor = AccountAccentColor(rgb: red << 16 | green << 8 | blue)
                self.hexText = self.customColor.hex
            }
        )
    }

    private func resetDraft() {
        self.customColor = self.store.accountPreferences.accentColor
        self.hexText = self.customColor.hex
    }

    private func selectColor(_ color: AccountAccentColor) {
        guard self.isUnavailable == false else { return }
        self.guidanceMessage = ""
        if color != .defaultColor && self.store.canUseCustomAccentColor == false {
            let requestId = self.premiumPresenter.present(
                reason: .premiumFeature(requiredTierRank: premiumTierRank),
                entitlement: self.store.cloudEntitlement
            )
            self.pendingSelection = PendingAccentColorSelection(
                requestId: requestId,
                identityKey: self.store.accountPreferencesIdentityKey,
                color: color
            )
            return
        }
        self.saveColor(color)
    }

    private func saveColor(_ color: AccountAccentColor) {
        guard self.isUnavailable == false else { return }
        self.isSaving = true
        let identityKey = self.store.accountPreferencesIdentityKey
        Task { @MainActor in
            defer { self.isSaving = false }
            guard identityKey == self.store.accountPreferencesIdentityKey else { return }
            do {
                try await self.store.updateAccentColor(color)
                if identityKey == self.store.accountPreferencesIdentityKey {
                    self.guidanceMessage = ""
                }
            } catch {
                if identityKey == self.store.accountPreferencesIdentityKey {
                    self.handleFailure(error)
                }
            }
        }
    }

    private func handleFailure(_ error: Error) {
        if isRequestCancellationError(error: error) { return }
        if isRetryableNetworkTransportFailure(error: error) {
            self.guidanceMessage = aiSettingsLocalized("settings.sync.failed.generic", "Sync failed")
        } else if let message = self.store.blockedCloudIdentityConflictMessage(error: error) {
            self.guidanceMessage = message
        } else {
            self.store.presentTechnicalError(error)
        }
    }
}
