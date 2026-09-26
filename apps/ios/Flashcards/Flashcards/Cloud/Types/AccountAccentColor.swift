import Foundation
import SwiftUI

struct AccountAccentColor: Codable, Hashable, Sendable {
    static let defaultColor = AccountAccentColor(rgb: 0xC44B2D)

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
    // An omitted snapshot is unknown; cached local cosmetics never expire by the device clock.
    var canUseCustomAccentColor: Bool {
        self.cloudEntitlement.map { $0.tierRank >= premiumTierRank } ?? true
    }

    var effectiveAccountAccentColor: AccountAccentColor {
        guard self.canUseCustomAccentColor else { return .defaultColor }
        if let pending = self.pendingAccentColor, pending.identityKey == self.accountPreferencesIdentityKey {
            return pending.color
        }
        return self.accountPreferences.accentColor
    }
}
