import SwiftUI

extension View {
    func reviewCardsShortcutHelp(key: String) -> some View {
        self.help(Text(String(
            format: String(
                localized: "Press %@",
                table: "ReviewCards",
                comment: "Native hover help for a keyboard shortcut. %@ is the key label."
            ),
            locale: Locale.current,
            key
        )))
    }
}
