import Foundation
import SwiftUI

struct AccountAccentColor: Codable, Hashable, Sendable {
    static let defaultColor = AccountAccentColor(rgb: 0xFF6719)

    let rgb: UInt32

    var hex: String {
        String(format: "#%06X", self.rgb)
    }

    var color: Color {
        Color(
            .sRGB,
            red: Double((self.rgb >> 16) & 0xFF) / 255,
            green: Double((self.rgb >> 8) & 0xFF) / 255,
            blue: Double(self.rgb & 0xFF) / 255,
            opacity: 1
        )
    }

    var contrastingForegroundColor: Color {
        self.relativeLuminance > 0.179 ? .black : .white
    }

    /// WCAG 2 relative luminance.
    private var relativeLuminance: Double {
        let channels: [Double] = [16, 8, 0].map { shift in
            let channel = Double((self.rgb >> shift) & 0xFF) / 255
            return channel <= 0.04045
                ? channel / 12.92
                : pow((channel + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
    }

    private var contrastAgainstWhite: Double {
        1.05 / (self.relativeLuminance + 0.05)
    }

    /// The shade painted in a theme; the saved color itself never changes.
    func displayed(theme: AccountTheme) -> AccountAccentColor {
        switch theme {
        case .dark:
            return self
        case .light:
            return self.darkenedForLightTheme()
        }
    }

    /// Darkened only as far as 3:1 contrast against white; a passing color is returned unchanged.
    private func darkenedForLightTheme() -> AccountAccentColor {
        let minimumContrast = 3.0
        guard self.contrastAgainstWhite < minimumContrast else { return self }
        var passingFactor = 0.0
        var failingFactor = 1.0
        for _ in 0..<24 {
            let factor = (passingFactor + failingFactor) / 2
            if self.scaled(factor: factor).contrastAgainstWhite >= minimumContrast {
                passingFactor = factor
            } else {
                failingFactor = factor
            }
        }
        return self.scaled(factor: passingFactor)
    }

    // Scaling every channel by one factor moves the color toward black and keeps its hue.
    private func scaled(factor: Double) -> AccountAccentColor {
        let channels: [UInt32] = [16, 8, 0].map { shift in
            UInt32((Double((self.rgb >> shift) & 0xFF) * factor).rounded(.down))
        }
        return AccountAccentColor(rgb: channels[0] << 16 | channels[1] << 8 | channels[2])
    }

    init(rgb: UInt32) {
        precondition(rgb <= 0xFFFFFF)
        self.rgb = rgb
    }

    init?(hex: String) {
        let bytes = Array(hex.utf8)
        guard bytes.count == 7, bytes[0] == 35,
              bytes.dropFirst().allSatisfy({ byte in
                  (48...57).contains(byte) || (65...70).contains(byte) || (97...102).contains(byte)
              }),
              let rgb = UInt32(hex.dropFirst(), radix: 16) else {
            return nil
        }
        self.rgb = rgb
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let hex = try container.decode(String.self)
        guard let color = AccountAccentColor(hex: hex) else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "accentColor must be an opaque RGB color in #RRGGBB format"
            )
        }
        self = color
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(self.hex)
    }
}

struct PendingAccountAccentColor {
    let id: UUID
    let identityKey: String
    let identityGeneration: Int
    let color: AccountAccentColor
}

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
