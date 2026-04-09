import SwiftUI

struct AccountLegalSupportView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    private var hasAcceptedAIDataUse: Bool {
        hasAIChatExternalProviderConsent(userDefaults: self.store.userDefaults)
    }

    var body: some View {
        List {
            Section(aiSettingsLocalized("settings.account.legal.section.links", "Links")) {
                if let privacyUrl = URL(string: flashcardsPrivacyPolicyUrl) {
                    Link(destination: privacyUrl) {
                        SettingsNavigationRow(
                            title: aiSettingsLocalized("common.privacyPolicy", "Privacy Policy"),
                            value: aiSettingsLocalized("common.open", "Open"),
                            systemImage: "hand.raised"
                        )
                    }
                }

                if let termsUrl = URL(string: flashcardsTermsOfServiceUrl) {
                    Link(destination: termsUrl) {
                        SettingsNavigationRow(
                            title: aiSettingsLocalized("common.termsOfService", "Terms of Service"),
                            value: aiSettingsLocalized("common.open", "Open"),
                            systemImage: "doc.text"
                        )
                    }
                }

                if let supportUrl = URL(string: flashcardsSupportUrl) {
                    Link(destination: supportUrl) {
                        SettingsNavigationRow(
                            title: aiSettingsLocalized("common.support", "Support"),
                            value: aiSettingsLocalized("common.open", "Open"),
                            systemImage: "questionmark.circle"
                        )
                    }
                }

                if let repositoryUrl = URL(string: flashcardsRepositoryUrl) {
                    Link(destination: repositoryUrl) {
                        SettingsNavigationRow(
                            title: aiSettingsLocalized("settings.account.legal.githubRepository", "GitHub Repository"),
                            value: aiSettingsLocalized("common.open", "Open"),
                            systemImage: "chevron.left.forwardslash.chevron.right"
                        )
                    }
                }
            }

            Section(aiSettingsLocalized("settings.account.legal.section.supportContact", "Support Contact")) {
                if let supportEmailUrl = URL(string: flashcardsSupportEmailUrl) {
                    Link(destination: supportEmailUrl) {
                        LabeledContent(aiSettingsLocalized("common.email", "Email")) {
                            Text(flashcardsSupportEmailAddress)
                        }
                    }
                } else {
                    LabeledContent(aiSettingsLocalized("common.email", "Email")) {
                        Text(flashcardsSupportEmailAddress)
                    }
                }

                Text(
                    aiSettingsLocalized(
                        "settings.account.legal.supportContactDescription",
                        "Use the support page for hosted app questions, account deletion help, and App Store review follow-up."
                    )
                )
                    .foregroundStyle(.secondary)
            }

            Section(aiSettingsLocalized("settings.account.legal.section.aiDataUse", "AI Data Use")) {
                LabeledContent(aiSettingsLocalized("settings.account.legal.statusOnThisDevice", "Status on this device")) {
                    Text(
                        self.hasAcceptedAIDataUse
                            ? aiSettingsLocalized("settings.account.legal.accepted", "Accepted")
                            : aiSettingsLocalized("settings.account.legal.notAccepted", "Not accepted")
                    )
                }

                Text(
                    aiSettingsLocalized(
                        "settings.account.legal.aiDataUseDescription",
                        "Using hosted AI is optional. If you enable it on this device, the following request data may be sent to third-party AI providers configured on the server:"
                    )
                )
                    .foregroundStyle(.secondary)

                ForEach(aiChatExternalProviderDisclosureItems, id: \.self) { item in
                    Text(
                        aiSettingsLocalizedFormat(
                            "settings.account.legal.disclosureBullet",
                            "- %@",
                            localizedAIChatDisclosureItem(item)
                        )
                    )
                        .foregroundStyle(.secondary)
                }

                Text(localizedAIChatAccuracyWarningText(aiChatAccuracyWarningText))
                    .foregroundStyle(.secondary)

                Text(
                    aiSettingsLocalized(
                        "settings.account.legal.reviewAiDataUse",
                        "Review and accept AI data use from the AI tab before using hosted AI."
                    )
                )
                    .foregroundStyle(.secondary)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(aiSettingsLocalized("settings.account.legal.title", "Legal & Support"))
    }
}

#Preview {
    NavigationStack {
        AccountLegalSupportView()
            .environment(FlashcardsStore())
    }
}
