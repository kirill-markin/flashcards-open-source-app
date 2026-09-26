import SwiftUI

private enum PremiumNavigationDestination: Hashable {
    case ownOpenAIKey
}

struct PremiumComingSoon: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(PremiumPresenter.self) private var presenter: PremiumPresenter

    let request: PremiumPresentationRequest

    private var isAILimit: Bool {
        self.request.reason == .aiLimit
    }

    private var showsOffer: Bool {
        if self.isAILimit {
            guard let entitlement = self.store.cloudEntitlement else {
                return false
            }
            return hasPremiumAccess(entitlement: entitlement) == false
        }
        return true
    }

    var body: some View {
        NavigationStack {
            List {
                if self.isAILimit {
                    Section {
                        Text(premiumAILimitTitle())
                            .font(.headline)
                        Text(self.limitMessage)
                            .accessibilityIdentifier(UITestIdentifier.premiumLimitMessage)
                    }
                    Section {
                        NavigationLink(value: PremiumNavigationDestination.ownOpenAIKey) {
                            Label(
                                aiSettingsLocalized("settings.ownOpenAIKey.title", "Your OpenAI key"),
                                systemImage: "key"
                            )
                        }
                        .accessibilityIdentifier(UITestIdentifier.premiumOwnKeyButton)
                    }
                }

                if self.showsOffer {
                    Section {
                        Text(premiumComingSoonTitle())
                            .font(.headline)
                        Text(premiumComingSoonMessage())
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(self.isAILimit ? premiumAILimitTitle() : premiumComingSoonTitle())
            .navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier(UITestIdentifier.premiumSheet)
            .navigationDestination(for: PremiumNavigationDestination.self) { destination in
                switch destination {
                case .ownOpenAIKey:
                    OwnOpenAIKeySettingsView()
                        .toolbar { self.closeToolbar }
                }
            }
            .toolbar { self.closeToolbar }
        }
    }

    @ToolbarContentBuilder
    private var closeToolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button(aiSettingsLocalized("common.close", "Close"), systemImage: "xmark") {
                self.presenter.finish(outcome: .dismissed)
            }
            .accessibilityIdentifier(UITestIdentifier.premiumCloseButton)
        }
    }

    private var limitMessage: String {
        let usage = self.store.currentAIMonthlyUsage.flatMap { usage in
            usage.monthEndsAt > Date() ? usage : nil
        }
        return aiChatAccountLimitReachedMessage(usage: usage)
    }
}
