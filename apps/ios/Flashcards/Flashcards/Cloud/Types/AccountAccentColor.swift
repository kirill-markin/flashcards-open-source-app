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

    private func contrastRatio(against backgroundLuminance: Double) -> Double {
        let luminance = self.relativeLuminance
        return (max(luminance, backgroundLuminance) + 0.05) / (min(luminance, backgroundLuminance) + 0.05)
    }

    func adjustedForContrast(against background: AccountAccentColor, minimumRatio: Double) -> AccountAccentColor {
        let backgroundLuminance = background.relativeLuminance
        guard self.contrastRatio(against: backgroundLuminance) < minimumRatio else { return self }

        let towardWhite = backgroundLuminance <= 0.179
        var passingWeight = 0.0
        var failingWeight = 1.0
        for _ in 0..<24 {
            let weight = (passingWeight + failingWeight) / 2
            let candidate = self.shaded(originalWeight: weight, towardWhite: towardWhite)
            if candidate.contrastRatio(against: backgroundLuminance) >= minimumRatio {
                passingWeight = weight
            } else {
                failingWeight = weight
            }
        }
        return self.shaded(originalWeight: passingWeight, towardWhite: towardWhite)
    }

    private func shaded(originalWeight: Double, towardWhite: Bool) -> AccountAccentColor {
        let channels: [UInt32] = [16, 8, 0].map { shift in
            let channel = Double((self.rgb >> shift) & 0xFF)
            return towardWhite
                ? UInt32((255 - (255 - channel) * originalWeight).rounded(.up))
                : UInt32((channel * originalWeight).rounded(.down))
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
