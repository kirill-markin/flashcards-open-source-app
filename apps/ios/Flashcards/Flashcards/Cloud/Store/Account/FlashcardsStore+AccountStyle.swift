import Foundation

@MainActor
extension FlashcardsStore {
    // Gates every Style setting; a confirmed free plan gets the defaults while saved values wait for Premium.
    // An omitted snapshot is unknown; cached local cosmetics never expire by the device clock.
    var canCustomizeStyle: Bool {
        self.cloudEntitlement.map { $0.tierRank >= premiumTierRank } ?? true
    }

    var effectiveAccountAccentColor: AccountAccentColor {
        guard self.canCustomizeStyle else { return .defaultColor }
        if let pending = self.pendingAccentColor, pending.identityKey == self.accountPreferencesIdentityKey {
            return pending.color
        }
        return self.accountPreferences.accentColor
    }

    /// The accent to paint with; selecting and saving compare `effectiveAccountAccentColor`.
    var displayedAccountAccentColor: AccountAccentColor {
        self.effectiveAccountAccentColor.displayed(theme: self.effectiveAccountTheme)
    }
}

@MainActor
extension FlashcardsStore {
    var effectiveAccountTheme: AccountTheme {
        self.canCustomizeStyle ? self.accountPreferences.theme : .defaultTheme
    }
}
