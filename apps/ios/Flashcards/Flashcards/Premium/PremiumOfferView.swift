import StoreKit
import SwiftUI

struct PremiumOfferView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(PremiumPresenter.self) private var presenter: PremiumPresenter
    @Environment(AppleSubscriptionService.self) private var subscriptions: AppleSubscriptionService

    let request: PremiumPresentationRequest
    @State private var offer: AppleSubscriptionOffer?
    @State private var priceText: String = ""
    @State private var trialText: String?
    @State private var isSandbox: Bool = false
    @State private var isLoading: Bool = true
    @State private var isPurchasing: Bool = false
    @State private var message: String?
    @State private var errorMessage: String?
    @State private var loadAttempt: Int = 0

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Label("Premium", systemImage: "sparkles")
                        .font(.largeTitle.bold())
                    Text(aiSettingsLocalized("premium.apple.notice", "Test purchases require TestFlight. Public sales are not open."))
                        .foregroundStyle(.secondary)
                    if let offer {
                        Text(offer.product.description)
                        if let trialText { Text(trialText).font(.headline) }
                        Text(self.priceText).font(.title2.bold())
                            .accessibilityIdentifier(UITestIdentifier.premiumPrice)
                        Text(aiSettingsLocalized("premium.apple.renewal", "Automatically renews until cancelled. Manage or cancel in your App Store subscriptions."))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        if self.isSandbox {
                            Button {
                                self.purchase()
                            } label: {
                                HStack {
                                    Text(aiSettingsLocalized("common.continue", "Continue"))
                                    if self.isPurchasing { ProgressView() }
                                }
                            }
                            .disabled(self.isPurchasing)
                            .accessibilityIdentifier(UITestIdentifier.premiumPurchaseButton)
                        }
                    }
                    if self.isLoading {
                        ProgressView(aiSettingsLocalized("common.loading", "Loading..."))
                    }
                    if let message {
                        Text(message).accessibilityIdentifier(UITestIdentifier.premiumPurchaseMessage)
                    }
                    if let errorMessage = self.errorMessage ?? self.subscriptions.runtimeErrorMessage {
                        Text(errorMessage).foregroundStyle(.red)
                            .accessibilityIdentifier(UITestIdentifier.premiumPurchaseError)
                        Button(aiSettingsLocalized("common.retry", "Retry")) {
                            self.loadAttempt += 1
                        }
                        .accessibilityIdentifier(UITestIdentifier.premiumRetryButton)
                    }
                }

                AppleSubscriptionControls(onRestore: {
                    guard self.presenter.request?.id == self.request.id,
                          self.subscriptions.currentPurchases.isEmpty == false else { return }
                    self.presenter.awaitAppleConfirmation(requestId: self.request.id, identity: try? self.store.appleSubscriptionIdentity())
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
            .navigationTitle("Premium")
            .navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier(UITestIdentifier.premiumOfferSheet)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(aiSettingsLocalized("common.close", "Close"), systemImage: "xmark") {
                        self.presenter.finish(outcome: .dismissed)
                    }
                    .accessibilityIdentifier(UITestIdentifier.premiumCloseButton)
                }
            }
        }
        .task(id: self.loadAttempt) {
            self.isLoading = true
            self.errorMessage = nil
            defer { self.isLoading = false }
            do {
                if self.loadAttempt > 0 { try await self.subscriptions.reconcileCurrentEntitlements() }
                let offer = try await self.subscriptions.loadOffer()
                let isSandbox = try await self.subscriptions.isSandboxTestEligible()
                guard let subscription = offer.product.subscription else { throw AppleSubscriptionError.productUnavailable }
                let period = try appleSubscriptionPeriodText(period: subscription.subscriptionPeriod, count: 1)
                let price = "\(offer.displayPrice) / \(period)"
                var trial: String? = nil
                if offer.isEligibleForIntroOffer, let intro = offer.product.subscription?.introductoryOffer,
                   intro.paymentMode == .freeTrial {
                    trial = aiSettingsLocalizedFormat(
                        "premium.apple.trial", "Free trial: %@. Then:",
                        try appleSubscriptionPeriodText(period: intro.period, count: intro.periodCount)
                    )
                }
                try Task.checkCancellation()
                self.offer = offer
                self.priceText = price
                self.trialText = trial
                self.isSandbox = isSandbox
            } catch is CancellationError {
                return
            } catch {
                guard Task.isCancelled == false else { return }
                self.errorMessage = aiSettingsLocalized("premium.apple.loadFailed", "Could not load the App Store offer. Check your connection and retry.") + "\n" + error.localizedDescription
            }
        }
    }

    private func purchase() {
        guard self.isPurchasing == false else { return }
        self.isPurchasing = true
        self.message = nil
        self.errorMessage = nil
        self.presenter.awaitAppleConfirmation(requestId: self.request.id, identity: try? self.store.appleSubscriptionIdentity())
        Task { @MainActor in
            defer { self.isPurchasing = false }
            do {
                switch try await self.subscriptions.purchaseSandboxPremium() {
                case .attached:
                    guard self.presenter.request?.id == self.request.id else { return }
                    self.presenter.confirmAppleAccess(entitlement: self.store.cloudEntitlement, identity: try? self.store.appleSubscriptionIdentity())
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
