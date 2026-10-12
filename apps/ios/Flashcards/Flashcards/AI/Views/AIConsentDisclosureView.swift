import SwiftUI

struct AIConsentDisclosureView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @State private var disclosure: AIConsentDisclosure = .current()
    let onAllowed: @MainActor () -> Void
    let onNotNow: @MainActor () -> Void

    var body: some View {
        ScrollView {
            ReadableContentLayout(maxWidth: flashcardsReadableFormMaxWidth, horizontalPadding: 24) {
                VStack(alignment: .leading, spacing: 16) {
                    Image(systemName: "hand.raised")
                        .font(.system(size: 40))
                        .foregroundStyle(.secondary)
                    Text(aiSettingsLocalized("ai.consent.dataSharingTitle", "AI data sharing"))
                        .font(.title3.weight(.semibold))
                        .accessibilityIdentifier(UITestIdentifier.aiConsentTitle)
                    Text(self.disclosure.text)
                        .accessibilityIdentifier(UITestIdentifier.aiConsentBody)
                    if self.store.aiConsent.isSaving {
                        ProgressView(aiSettingsLocalized("ai.consent.saving", "Saving your choice…"))
                            .accessibilityIdentifier(UITestIdentifier.aiConsentSaving)
                    }
                    if let failure = self.store.aiConsent.failureMessage {
                        Text(failure)
                            .foregroundStyle(.red)
                            .accessibilityIdentifier(UITestIdentifier.aiConsentFailure)
                        Button(aiSettingsLocalized("ai.consent.retrySync", "Retry saving choice")) {
                            self.store.retryAIConsentSync()
                        }
                        .disabled(self.store.aiConsent.isSaving)
                        .accessibilityIdentifier(UITestIdentifier.aiConsentRetryButton)
                    }
                    Button(aiSettingsLocalized("ai.consent.allowDataSharing", "Allow AI data sharing")) {
                        if self.store.hasAIDataSharingConsent {
                            self.onAllowed()
                        } else {
                            self.store.allowAIDataSharing(disclosure: self.disclosure)
                        }
                    }
                    .nativeProminentActionButtonStyle()
                    .disabled(self.store.aiConsent.isSaving)
                    .accessibilityIdentifier(UITestIdentifier.aiConsentAcceptButton)
                    Button(aiSettingsLocalized("ai.consent.notNow", "Not now")) {
                        self.store.withdrawAIDataSharing(disclosure: self.disclosure)
                        self.onNotNow()
                    }
                    .accessibilityIdentifier(UITestIdentifier.aiConsentNotNowButton)
                    if let url = URL(string: flashcardsPrivacyPolicyUrl) {
                        Link(aiSettingsLocalized("common.privacyPolicy", "Privacy Policy"), destination: url)
                            .accessibilityIdentifier(UITestIdentifier.aiConsentPrivacyLink)
                    }
                }
                .padding(.vertical, 24)
            }
        }
        .onChange(of: self.store.hasAIDataSharingConsent) { _, allowed in
            if allowed { self.onAllowed() }
        }
    }
}
