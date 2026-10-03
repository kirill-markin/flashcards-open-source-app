import StoreKit
import SwiftUI

private enum PremiumNavigationDestination: Hashable {
    case ownOpenAIKey
}

struct PremiumOfferView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(PremiumPresenter.self) private var presenter: PremiumPresenter
    @Environment(AppleSubscriptionService.self) private var subscriptions: AppleSubscriptionService

    let request: PremiumPresentationRequest
    @State private var offer: AppleSubscriptionOffer?
    @State private var priceText: String = ""
    @State private var trialText: String?
    @State private var isLoading: Bool = true
    @State private var isPurchasing: Bool = false
    @State private var message: String?
    @State private var errorMessage: String?
    @State private var loadAttempt: Int = 0

    private var isAILimit: Bool { self.request.reason == .aiLimit }
    private var hasAccess: Bool { hasPremiumAccess(entitlement: self.store.cloudEntitlement) }
    private var canPurchase: Bool {
        guard let identity = self.request.identity,
              identity == (try? self.store.appleSubscriptionIdentity()),
              self.store.cloudEntitlement != nil else { return false }
        return self.hasAccess == false
    }
    private var showsOffer: Bool {
        self.isAILimit == false || (self.store.cloudEntitlement != nil && self.hasAccess == false)
    }

    var body: some View {
        NavigationStack {
            List {
                if self.isAILimit {
                    Section {
                        Text(premiumAILimitTitle()).font(.headline)
                        Text(self.limitMessage)
                            .accessibilityIdentifier(UITestIdentifier.premiumLimitMessage)
                    }
                    Section {
                        NavigationLink(value: PremiumNavigationDestination.ownOpenAIKey) {
                            Label(aiSettingsLocalized("settings.ownOpenAIKey.title", "Your OpenAI key"), systemImage: "key")
                        }
                        .accessibilityIdentifier(UITestIdentifier.premiumOwnKeyButton)
                    }
                }

                if self.showsOffer {
                    Section {
                        Label(premiumOfferTitle(), systemImage: "sparkles")
                            .font(.largeTitle.bold())
                        Text(aiSettingsLocalized(
                            "premium.offer.benefits",
                            "1,000 AI messages per month and custom accent colors. Sync is free for everyone."
                        ))
                        if self.hasAccess, let entitlement = self.store.cloudEntitlement {
                            LabeledContent(aiSettingsLocalized("settings.subscription.plan", "Plan")) {
                                Text(entitlement.tierDisplayName)
                            }
                        }
                        if let offer {
                            Text(offer.product.description)
                            if self.canPurchase, let trialText { Text(trialText).font(.headline) }
                            Text(self.priceText).font(.title2.bold())
                                .accessibilityIdentifier(UITestIdentifier.premiumPrice)
                            Text(aiSettingsLocalized("premium.apple.renewal", "Automatically renews until cancelled. Manage or cancel in your App Store subscriptions."))
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                            if self.hasAccess == false {
                                Button {
                                    self.purchase()
                                } label: {
                                    HStack {
                                        Text(aiSettingsLocalized("common.continue", "Continue"))
                                        if self.isPurchasing { ProgressView() }
                                    }
                                }
                                .disabled(self.isPurchasing || self.isLoading || self.canPurchase == false)
                                .accessibilityIdentifier(UITestIdentifier.premiumPurchaseButton)
                            }
                        }
                    }
                }

                if self.isLoading {
                    Section {
                        ProgressView(aiSettingsLocalized("common.loading", "Loading..."))
                    }
                }

                if let message {
                    Section {
                        Text(message).accessibilityIdentifier(UITestIdentifier.premiumPurchaseMessage)
                    }
                }
                if let errorMessage = self.errorMessage ?? self.subscriptions.runtimeErrorMessage {
                    Section {
                        Text(errorMessage).foregroundStyle(.red)
                            .accessibilityIdentifier(UITestIdentifier.premiumPurchaseError)
                        Button(aiSettingsLocalized("common.retry", "Retry")) {
                            self.loadAttempt += 1
                        }
                        .disabled(self.isPurchasing || self.isLoading)
                        .accessibilityIdentifier(UITestIdentifier.premiumRetryButton)
                    }
                }

                AppleSubscriptionControls(isRestoreDisabled: false, onRestore: {
                    guard self.presenter.request?.id == self.request.id,
                          self.subscriptions.currentPurchases.isEmpty == false else { return }
                    self.presenter.awaitAppleConfirmation(requestId: self.request.id, identity: self.request.identity)
                    self.presenter.confirmAppleAccess(entitlement: self.store.cloudEntitlement, identity: try? self.store.appleSubscriptionIdentity())
                })
                .disabled(self.isPurchasing)

                Section {
                    if let privacyURL = URL(string: flashcardsPrivacyPolicyUrl) {
                        Link(aiSettingsLocalized("common.privacyPolicy", "Privacy Policy"), destination: privacyURL)
                            .accessibilityIdentifier(UITestIdentifier.premiumPrivacyLink)
                    }
                    if let eulaURL = URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/") {
                        Link(aiSettingsLocalized("common.termsOfService", "Terms of Service"), destination: eulaURL)
                            .accessibilityIdentifier(UITestIdentifier.premiumEULALink)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(self.isAILimit ? premiumAILimitTitle() : premiumOfferTitle())
            .navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier(UITestIdentifier.premiumOfferSheet)
            .navigationDestination(for: PremiumNavigationDestination.self) { destination in
                switch destination {
                case .ownOpenAIKey:
                    OwnOpenAIKeySettingsView()
                        .toolbar { self.closeToolbar }
                }
            }
            .toolbar { self.closeToolbar }
        }
        .task(id: self.loadAttempt) {
            self.isLoading = true
            self.errorMessage = nil
            defer { self.isLoading = false }
            do {
                guard self.presenter.request?.id == self.request.id else { return }
                guard let identity = self.request.identity else { throw AppleSubscriptionError.accountUnavailable }
                try self.store.requireAppleSubscriptionIdentity(identity)
                if self.loadAttempt > 0 {
                    try await self.subscriptions.reconcileCurrentEntitlements()
                } else if self.store.cloudEntitlement == nil {
                    try await self.store.refreshAppleSubscriptionEntitlement(identity: identity)
                }
                try self.store.requireAppleSubscriptionIdentity(identity)
                guard self.presenter.request?.id == self.request.id else { return }
                guard self.showsOffer else { return }
                let offer = try await self.subscriptions.loadOffer()
                guard let subscription = offer.product.subscription else { throw AppleSubscriptionError.productUnavailable }
                let period = try appleSubscriptionPeriodText(period: subscription.subscriptionPeriod, count: 1)
                let price = "\(offer.displayPrice) / \(period)"
                var trial: String? = nil
                if offer.isEligibleForIntroOffer, let intro = subscription.introductoryOffer,
                   intro.paymentMode == .freeTrial {
                    trial = aiSettingsLocalizedFormat(
                        "premium.apple.trial", "Free trial: %@. Then:",
                        try appleSubscriptionPeriodText(period: intro.period, count: intro.periodCount)
                    )
                }
                try self.store.requireAppleSubscriptionIdentity(identity)
                guard self.presenter.request?.id == self.request.id else { return }
                self.offer = offer
                self.priceText = price
                self.trialText = trial
            } catch is CancellationError {
                return
            } catch {
                guard Task.isCancelled == false, self.presenter.request?.id == self.request.id else { return }
                self.errorMessage = aiSettingsLocalized("premium.apple.loadFailed", "Could not load the App Store offer. Check your connection and retry.") + "\n" + error.localizedDescription
            }
        }
        .onChange(of: self.showsOffer) { _, showsOffer in
            if showsOffer, self.isLoading == false { self.loadAttempt += 1 }
        }
    }

    @ToolbarContentBuilder
    private var closeToolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button(aiSettingsLocalized("common.close", "Close"), systemImage: "xmark") {
                guard self.presenter.request?.id == self.request.id else { return }
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

    private func purchase() {
        guard self.isPurchasing == false, self.isLoading == false, self.canPurchase,
              self.presenter.request?.id == self.request.id else { return }
        self.isPurchasing = true
        self.message = nil
        self.errorMessage = nil
        self.presenter.awaitAppleConfirmation(requestId: self.request.id, identity: self.request.identity)
        Task { @MainActor in
            defer { self.isPurchasing = false }
            do {
                guard let identity = self.request.identity else { throw AppleSubscriptionError.accountUnavailable }
                try self.store.requireAppleSubscriptionIdentity(identity)
                let result = try await self.subscriptions.purchasePremium()
                try self.store.requireAppleSubscriptionIdentity(identity)
                guard self.presenter.request?.id == self.request.id else { return }
                switch result {
                case .attached:
                    self.presenter.confirmAppleAccess(entitlement: self.store.cloudEntitlement, identity: identity)
                    self.message = aiSettingsLocalized("premium.apple.pending", "Waiting for Apple or account confirmation. Restore purchases to retry.")
                case .pending:
                    self.message = aiSettingsLocalized("premium.apple.pending", "Waiting for Apple or account confirmation. Restore purchases to retry.")
                case .cancelled:
                    self.presenter.cancelAppleConfirmation(requestId: self.request.id)
                    self.message = aiSettingsLocalized("premium.apple.cancelled", "Purchase cancelled. You have not been charged.")
                }
            } catch {
                guard self.presenter.request?.id == self.request.id else { return }
                self.errorMessage = aiSettingsLocalized("premium.apple.failed", "Purchase could not be confirmed. Restore purchases to retry without buying again.") + "\n" + error.localizedDescription
            }
        }
    }
}

private func appleSubscriptionPeriodText(period: Product.SubscriptionPeriod, count: Int) throws -> String {
    var components = DateComponents()
    switch period.unit {
    case .day: components.day = period.value * count
    case .week: components.weekOfMonth = period.value * count
    case .month: components.month = period.value * count
    case .year: components.year = period.value * count
    @unknown default: throw AppleSubscriptionError.productUnavailable
    }
    let formatter = DateComponentsFormatter()
    formatter.unitsStyle = .full
    guard let text = formatter.string(from: components) else {
        throw AppleSubscriptionError.productUnavailable
    }
    return text
}
