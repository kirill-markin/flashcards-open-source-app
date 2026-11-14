import SwiftUI
import UIKit

extension EnvironmentValues {
    @Entry var isKeyboardDocked: Bool = false
}

/// Owns the docked-keyboard flag below the root view, so a docking change updates only the views that read it.
struct DockedKeyboardEnvironment<Content: View>: View {
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel
    @State private var isDocked: Bool = false
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        self.content
            .ignoresSafeArea(UIDevice.current.userInterfaceIdiom == .pad || self.isDocked || self.navigation.canPresentAICompanion == false ? [] : .keyboard, edges: .bottom)
            .environment(\.isKeyboardDocked, self.isDocked)
            .background {
                DockedKeyboardObserver(isDocked: self.$isDocked)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
    }
}

/// Reads the native docked-keyboard guide without following floating keyboards.
/// The background fills the scene so this remains independent of content insets.
struct DockedKeyboardObserver: UIViewRepresentable {
    @Binding var isDocked: Bool

    func makeUIView(context: Context) -> KeyboardGuideView {
        let view = KeyboardGuideView()
        view.onDockingChange = { isDocked in
            // UIKit can lay out while SwiftUI is updating the background.
            DispatchQueue.main.async {
                self.isDocked = isDocked
            }
        }
        return view
    }

    func updateUIView(_ uiView: KeyboardGuideView, context: Context) {}

    final class KeyboardGuideView: UIView {
        var onDockingChange: ((Bool) -> Void)?
        private var lastIsDocked: Bool?

        override init(frame: CGRect) {
            super.init(frame: frame)
            self.isUserInteractionEnabled = false
            self.keyboardLayoutGuide.followsUndockedKeyboard = false
            self.keyboardLayoutGuide.usesBottomSafeArea = false
            let probe = UIView()
            probe.translatesAutoresizingMaskIntoConstraints = false
            self.addSubview(probe)
            NSLayoutConstraint.activate([
                probe.topAnchor.constraint(equalTo: self.keyboardLayoutGuide.topAnchor),
                probe.bottomAnchor.constraint(equalTo: self.bottomAnchor),
                probe.leadingAnchor.constraint(equalTo: self.leadingAnchor),
                probe.trailingAnchor.constraint(equalTo: self.trailingAnchor)
            ])
        }

        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

        override func layoutSubviews() {
            super.layoutSubviews()
            let isDocked = self.keyboardLayoutGuide.layoutFrame.height > 1
            guard isDocked != self.lastIsDocked else { return }
            self.lastIsDocked = isDocked
            self.onDockingChange?(isDocked)
        }
    }
}
