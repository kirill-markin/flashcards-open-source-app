import SwiftUI

struct AccountLegalSupportView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    private var hasAcceptedAIDataUse: Bool {
        hasAIChatExternalProviderConsent(userDefaults: self.store.userDefaults)
    }

    var body: some View {
        List {
            Section("Links") {
                if let privacyUrl = URL(string: flashcardsPrivacyPolicyUrl) {
                    Link(destination: privacyUrl) {
                        SettingsNavigationRow(
                            title: "Privacy Policy",
                            value: "Open",
                            systemImage: "hand.raised"
                        )
                    }
                }

                if let termsUrl = URL(string: flashcardsTermsOfServiceUrl) {
                    Link(destination: termsUrl) {
                        SettingsNavigationRow(
                            title: "Terms of Service",
                            value: "Open",
                            systemImage: "doc.text"
                        )
                    }
                }

                if let supportUrl = URL(string: flashcardsSupportUrl) {
                    Link(destination: supportUrl) {
                        SettingsNavigationRow(
                            title: "Support",
                            value: "Open",
                            systemImage: "questionmark.circle"
                        )
                    }
                }

                if let repositoryUrl = URL(string: flashcardsRepositoryUrl) {
                    Link(destination: repositoryUrl) {
                        SettingsNavigationRow(
                            title: "GitHub Repository",
                            value: "Open",
                            systemImage: "chevron.left.forwardslash.chevron.right"
                        )
                    }
                }
            }

            Section("Support Contact") {
                if let supportEmailUrl = URL(string: flashcardsSupportEmailUrl) {
                    Link(destination: supportEmailUrl) {
                        LabeledContent("Email") {
                            Text(flashcardsSupportEmailAddress)
                        }
                    }
                } else {
                    LabeledContent("Email") {
                        Text(flashcardsSupportEmailAddress)
                    }
                }

                Text("Use the support page for hosted app questions, account deletion help, and App Store review follow-up.")
                    .foregroundStyle(.secondary)
            }

            Section("AI Data Use") {
                LabeledContent("Status on this device") {
                    Text(self.hasAcceptedAIDataUse ? "Accepted" : "Not accepted")
                }

                Text("Using hosted AI is optional. If you enable it on this device, the following request data may be sent to third-party AI providers configured on the server:")
                    .foregroundStyle(.secondary)

                ForEach(aiChatExternalProviderDisclosureItems, id: \.self) { item in
                    Text("- \(item)")
                        .foregroundStyle(.secondary)
                }

                Text(aiChatAccuracyWarningText)
                    .foregroundStyle(.secondary)

                Text("Review and accept AI data use from the AI tab before using hosted AI.")
                    .foregroundStyle(.secondary)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Legal & Support")
    }
}

#Preview {
    NavigationStack {
        AccountLegalSupportView()
            .environment(FlashcardsStore())
    }
}
