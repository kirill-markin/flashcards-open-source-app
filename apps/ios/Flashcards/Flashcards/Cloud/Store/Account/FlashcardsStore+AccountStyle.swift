import SwiftUI

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

    /// The accent to paint with in the resolved `colorScheme`; selecting and saving compare `effectiveAccountAccentColor`.
    func displayedAccountAccentColor(colorScheme: ColorScheme) -> AccountAccentColor {
        self.effectiveAccountAccentColor.displayed(colorScheme: colorScheme)
    }
}

@MainActor
extension FlashcardsStore {
    var effectiveAccountThemeSelection: AccountThemeSelection {
        guard self.canCustomizeStyle else { return .defaultSelection }
        return AccountThemeSelection(
            theme: self.accountPreferences.theme,
            followSystemAppearance: self.accountPreferences.followSystemAppearance
        )
    }
}
