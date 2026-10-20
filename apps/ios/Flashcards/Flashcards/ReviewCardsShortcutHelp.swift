import SwiftUI

extension View {
    func reviewCardsShortcutHelp(key: String) -> some View {
        self.help(Text(reviewCardsShortcutHelpText(key: key)))
    }
}

private func reviewCardsShortcutHelpText(key: String) -> String {
    String(
        format: String(
            localized: "Press %@",
            table: "ReviewCards",
            comment: "Native hover help for a keyboard shortcut. %@ is the key label."
        ),
        locale: Locale.current,
        key
    )
}

#if targetEnvironment(macCatalyst)
extension View {
    func catalystReviewShortcutHint(key: String) -> some View {
        self.modifier(CatalystReviewShortcutHint(key: key))
    }

    func catalystReviewShortcutHintOverlay() -> some View {
        self.overlayPreferenceValue(CatalystReviewShortcutHintAnchor.self) { hint in
            GeometryReader { geometry in
                if let hint {
                    let target = geometry[hint.bounds]
                    Text(hint.help)
                        .font(.caption)
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .frame(maxWidth: min(240, target.width))
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 5))
                        .accessibilityIdentifier("review.shortcutHint")
                        .visualEffect { content, geometry in
                            content.offset(
                                x: target.midX - geometry.size.width / 2,
                                y: target.minY - geometry.size.height - 8
                            )
                        }
                }
            }
            .allowsHitTesting(false)
        }
    }
}

private struct CatalystReviewShortcutHintAnchor: PreferenceKey {
    struct Hint {
        let bounds: Anchor<CGRect>
        let help: String
    }

    static let defaultValue: Hint? = nil

    static func reduce(value: inout Hint?, nextValue: () -> Hint?) {
        value = nextValue() ?? value
    }
}

private struct CatalystReviewShortcutHint: ViewModifier {
    let key: String
    @Environment(\.scenePhase) private var scenePhase
    @State private var isHovered: Bool = false

    func body(content: Content) -> some View {
        content
            .onHover { self.isHovered = $0 }
            .anchorPreference(key: CatalystReviewShortcutHintAnchor.self, value: .bounds) { bounds in
                self.isHovered && self.scenePhase == .active
                    ? CatalystReviewShortcutHintAnchor.Hint(
                        bounds: bounds, help: reviewCardsShortcutHelpText(key: self.key)
                    ) : nil
            }
            .onChange(of: self.scenePhase) { _, phase in
                if phase != .active {
                    self.isHovered = false
                }
            }
            .onDisappear { self.isHovered = false }
    }
}
#endif
