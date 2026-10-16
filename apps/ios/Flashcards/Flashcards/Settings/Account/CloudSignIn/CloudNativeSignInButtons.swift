import AuthenticationServices
import SwiftUI

struct CloudBrandedProviderButton: View {
    let provider: CloudAuthProvider
    let onPress: (UIViewController) -> Void
    @ScaledMetric(relativeTo: .body) private var buttonHeight: CGFloat = 48

    var body: some View {
        CloudNativeProviderControl(provider: self.provider, height: self.buttonHeight, onPress: self.onPress)
            .frame(maxWidth: .infinity)
            .frame(height: self.buttonHeight)
    }
}

private struct CloudNativeProviderControl: UIViewRepresentable {
    let provider: CloudAuthProvider
    let height: CGFloat
    let onPress: (UIViewController) -> Void

    func makeUIView(context: Context) -> UIControl {
        let button: UIControl
        switch self.provider {
        case .apple:
            button = ASAuthorizationAppleIDButton(type: .continue, style: .white)
        case .google:
            let google = UIButton(type: .system)
            google.configuration = cloudRoundedSignInButtonConfiguration(
                title: aiSettingsLocalized("settings.account.cloudSignIn.continueGoogle", "Continue with Google"),
                image: UIImage(named: "GoogleSignInG")?.withRenderingMode(.alwaysOriginal),
                imagePadding: 12
            )
            google.titleLabel?.numberOfLines = 0
            google.titleLabel?.adjustsFontForContentSizeCategory = true
            google.contentHorizontalAlignment = .center
            google.configurationUpdateHandler = { button in
                // Google requires Google Sans Medium; registration is scoped to this app bundle.
                let descriptor = UIFontDescriptor(fontAttributes: [
                    .family: "Google Sans",
                    .traits: [UIFontDescriptor.TraitKey.weight: UIFont.Weight.medium]
                ])
                updateCloudSignInButtonFont(button, font: UIFont(descriptor: descriptor, size: 14))
            }
            button = google
        }
        button.addTarget(context.coordinator, action: #selector(Coordinator.pressed(_:)), for: .touchUpInside)
        return button
    }

    func updateUIView(_ view: UIControl, context: Context) {
        view.isEnabled = context.environment.isEnabled
        if let apple = view as? ASAuthorizationAppleIDButton {
            apple.cornerRadius = self.height / 2
        }
        context.coordinator.onPress = self.onPress
    }

    func makeCoordinator() -> Coordinator { Coordinator(onPress: self.onPress) }

    @MainActor
    final class Coordinator: NSObject {
        var onPress: (UIViewController) -> Void
        init(onPress: @escaping (UIViewController) -> Void) { self.onPress = onPress }
        @objc func pressed(_ sender: UIControl) {
            guard var presenter = sender.window?.rootViewController else { return }
            while let presented = presenter.presentedViewController { presenter = presented }
            self.onPress(presenter)
        }
    }
}

struct CloudEmailSignInButton: UIViewRepresentable {
    let onPress: () -> Void

    func makeUIView(context: Context) -> UIButton {
        let button = UIButton(type: .system)
        button.configuration = cloudRoundedSignInButtonConfiguration(
            title: aiSettingsLocalized("settings.account.cloudSignIn.continueEmail", "Continue with Email"),
            image: UIImage(systemName: "envelope"),
            imagePadding: 12
        )
        button.titleLabel?.numberOfLines = 0
        button.titleLabel?.adjustsFontForContentSizeCategory = true
        button.contentHorizontalAlignment = .center
        button.configurationUpdateHandler = { button in
            updateCloudSignInButtonFont(button, font: .systemFont(ofSize: 17, weight: .medium))
        }
        button.addTarget(context.coordinator, action: #selector(Coordinator.pressed), for: .touchUpInside)
        return button
    }

    func updateUIView(_ view: UIButton, context: Context) {
        view.isEnabled = context.environment.isEnabled
        context.coordinator.onPress = self.onPress
    }

    func makeCoordinator() -> Coordinator { Coordinator(onPress: self.onPress) }

    @MainActor
    final class Coordinator: NSObject {
        var onPress: () -> Void
        init(onPress: @escaping () -> Void) { self.onPress = onPress }
        @objc func pressed() { self.onPress() }
    }
}

private func cloudRoundedSignInButtonConfiguration(
    title: String,
    image: UIImage?,
    imagePadding: CGFloat
) -> UIButton.Configuration {
    var configuration = UIButton.Configuration.filled()
    configuration.title = title
    configuration.titleAlignment = .center
    configuration.titleLineBreakMode = .byWordWrapping
    configuration.image = image
    configuration.imagePadding = imagePadding
    configuration.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16)
    configuration.cornerStyle = .capsule
    configuration.baseBackgroundColor = .white
    configuration.baseForegroundColor = UIColor(white: 31 / 255, alpha: 1)
    configuration.background.strokeColor = UIColor(red: 116 / 255, green: 119 / 255, blue: 117 / 255, alpha: 1)
    configuration.background.strokeWidth = 1
    return configuration
}

private func updateCloudSignInButtonFont(_ button: UIButton, font: UIFont) {
    let scaledFont = UIFontMetrics(forTextStyle: .body).scaledFont(for: font, compatibleWith: button.traitCollection)
    button.configuration?.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
        var attributes = incoming
        attributes.font = scaledFont
        return attributes
    }
}
