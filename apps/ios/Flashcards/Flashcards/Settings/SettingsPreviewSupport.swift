import SwiftUI

private let arabicPreviewLocale = Locale(identifier: "ar")

extension View {
    func arabicRTLPreview() -> some View {
        self
            .environment(\.locale, arabicPreviewLocale)
            .environment(\.layoutDirection, .rightToLeft)
    }
}
