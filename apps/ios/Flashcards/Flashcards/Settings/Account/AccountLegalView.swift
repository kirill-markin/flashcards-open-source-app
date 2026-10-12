import SwiftUI

struct AccountLegalView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @State private var isDisclosurePresented: Bool = false

    var body: some View {
        List {
            Section(aiSettingsLocalized("settings.account.legal.section.links", "Links")) {
                if let privacyUrl = URL(string: flashcardsPrivacyPolicyUrl) {
                    Link(destination: privacyUrl) {
                        SettingsNavigationRow(
                            title: aiSettingsLocalized("common.privacyPolicy", "Privacy Policy"),
                            value: aiSettingsLocalized("common.open", "Open"),
                            systemImage: "hand.raised",
                            attentionCount: nil
                        )
                    }
                }

                if let termsUrl = URL(string: flashcardsTermsOfServiceUrl) {
                    Link(destination: termsUrl) {
                        SettingsNavigationRow(
                            title: aiSettingsLocalized("common.termsOfService", "Terms of Service"),
                            value: aiSettingsLocalized("common.open", "Open"),
                            systemImage: "doc.text",
                            attentionCount: nil
                        )
                    }
                }

                if let repositoryUrl = URL(string: flashcardsRepositoryUrl) {
                    Link(destination: repositoryUrl) {
                        SettingsNavigationRow(
                            title: aiSettingsLocalized("settings.account.legal.githubRepository", "GitHub Repository"),
                            value: aiSettingsLocalized("common.open", "Open"),
                            systemImage: "chevron.left.forwardslash.chevron.right",
                            attentionCount: nil
                        )
                    }
                }
            }

            Section(aiSettingsLocalized("settings.account.legal.section.aiDataUse", "AI Data Use")) {
                LabeledContent(aiSettingsLocalized("settings.account.legal.statusOnThisDevice", "Status on this device")) {
                    Text(
                        self.store.hasAIDataSharingConsent
                            ? aiSettingsLocalized("settings.account.legal.accepted", "Accepted")
                            : aiSettingsLocalized("settings.account.legal.notAccepted", "Not accepted")
                    )
                }

                if let decision = self.store.aiConsent.currentDecision {
                    LabeledContent(
                        decision.evidence.action == .grant
                            ? aiSettingsLocalized("settings.account.legal.acceptedAt", "Allowed on this device")
                            : aiSettingsLocalized("settings.account.legal.withdrawnAt", "Turned off on this device")
                    ) {
                        if let date = aiConsentDate(decision.evidence.occurredAt) {
                            Text(date.formatted(date: .long, time: .standard))
                        }
                    }
                    .accessibilityIdentifier(UITestIdentifier.aiConsentActionTime)
                    .accessibilityValue(decision.evidence.occurredAt)
                    LabeledContent(aiSettingsLocalized("settings.account.legal.consentVersion", "Disclosure version")) {
                        Text(decision.evidence.disclosureVersion)
                    }
                    .accessibilityIdentifier(UITestIdentifier.aiConsentVersion)
                    .accessibilityValue(decision.evidence.disclosureVersion)
                    if let receipt = decision.receipt, let date = aiConsentDate(receipt.receivedAt) {
                        LabeledContent(aiSettingsLocalized("settings.account.legal.receivedAt", "Saved by Nibomo")) {
                            Text(date.formatted(date: .long, time: .standard))
                        }
                        .accessibilityIdentifier(UITestIdentifier.aiConsentReceivedTime)
                        .accessibilityValue(receipt.receivedAt)
                        Text(receipt.eventId.uuidString.lowercased())
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .accessibilityIdentifier(UITestIdentifier.aiConsentReceiptId)
                    }
                }
                if self.store.aiConsent.hasPendingDecisions {
                    Text(aiSettingsLocalized("settings.account.legal.consentPending", "Your choice is saved on this device and waiting to sync."))
                        .accessibilityIdentifier(UITestIdentifier.aiConsentPending)
                    Button(aiSettingsLocalized("ai.consent.retrySync", "Retry saving choice")) {
                        self.store.retryAIConsentSync()
                    }
                    .disabled(self.store.aiConsent.isSaving)
                    .accessibilityIdentifier(UITestIdentifier.aiConsentRetryButton)
                }
                if self.store.aiConsent.isSaving {
                    ProgressView(aiSettingsLocalized("ai.consent.saving", "Saving your choice…"))
                }
                if let failure = self.store.aiConsent.failureMessage {
                    Text(failure)
                        .foregroundStyle(.red)
                        .accessibilityIdentifier(UITestIdentifier.aiConsentFailure)
                }
                Button(aiSettingsLocalized("settings.account.legal.reviewAiDisclosure", "Review AI data sharing")) {
                    self.isDisclosurePresented = true
                }
                .accessibilityIdentifier(UITestIdentifier.aiConsentReviewButton)
                if self.store.aiConsent.currentDecision?.evidence.action == .grant {
                    Button(aiSettingsLocalized("settings.account.legal.withdrawAiConsent", "Turn off AI data sharing"), role: .destructive) {
                        self.store.withdrawAIDataSharing(disclosure: .current())
                    }
                    .accessibilityIdentifier(UITestIdentifier.aiConsentWithdrawButton)
                }
                Text(aiSettingsLocalized("ai.consent.withdrawalBody", "Turning this off stops new AI requests. It does not delete existing chats or data already sent to OpenAI."))
                    .foregroundStyle(.secondary)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(aiSettingsLocalized("settings.account.legal.title", "Legal"))
        .sheet(isPresented: self.$isDisclosurePresented) {
            NavigationStack {
                AIConsentDisclosureView(
                    onAllowed: { self.isDisclosurePresented = false },
                    onNotNow: { self.isDisclosurePresented = false }
                )
            }
        }
    }
}

struct AccountSupportView: View {
    var body: some View {
        List {
            Section(aiSettingsLocalized("settings.account.support.section.links", "Links")) {
                if let supportUrl = URL(string: flashcardsSupportUrl) {
                    Link(destination: supportUrl) {
                        SettingsNavigationRow(
                            title: aiSettingsLocalized("common.support", "Support"),
                            value: aiSettingsLocalized("common.open", "Open"),
                            systemImage: "questionmark.circle",
                            attentionCount: nil
                        )
                    }
                }
            }

            Section(aiSettingsLocalized("settings.account.support.section.contact", "Support Contact")) {
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
                        "settings.account.support.contactDescription",
                        "Use the support page for hosted app questions, account deletion help, and App Store review follow-up."
                    )
                )
                    .foregroundStyle(.secondary)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(aiSettingsLocalized("settings.account.support.title", "Support"))
    }
}

#Preview("Default") {
    NavigationStack {
        AccountLegalView()
            .environment(FlashcardsStore())
    }
}

#Preview("Arabic RTL") {
    NavigationStack {
        AccountLegalView()
            .environment(FlashcardsStore())
    }
    .arabicRTLPreview()
}

#Preview("Support") {
    NavigationStack {
        AccountSupportView()
    }
}
