import StoreKit
import SwiftUI
import UIKit

private enum PremiumNavigationDestination: Hashable {
    case ownOpenAIKey
}

struct PremiumOfferView: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(PremiumPresenter.self) private var presenter: PremiumPresenter
    @Environment(AppleSubscriptionService.self) private var subscriptions: AppleSubscriptionService

    let request: PremiumPresentationRequest
    @State private var offer: AppleSubscriptionOffer?
    @State private var priceText: String = ""
    @State private var trialText: String?
    @State private var purchaseTitle: String = ""
    @State private var premiumAIAllowance: PremiumAIUsageStatusResponse?
    @State private var isLoading: Bool = true
    @State private var isPurchasing: Bool = false
    @State private var message: String?
    @State private var errorMessage: String?
    @State private var loadAttempt: Int = 0
    @State private var isPreviewPurchaseAlertPresented: Bool = false

    private var isPreview: Bool { self.request.analyticsEntryPoint == nil }
    private var isTestOfferPreview: Bool { self.isPreview && self.request.reason == .offerPreview }
    private var isAILimit: Bool { self.request.reason == .aiLimit }
    private var hasAccess: Bool { hasPremiumAccess(entitlement: self.store.cloudEntitlement) }
    private var canPurchase: Bool {
        if self.isTestOfferPreview { return true }
        guard let identity = self.request.identity,
              identity == (try? self.store.appleSubscriptionIdentity()),
              self.store.cloudEntitlement != nil else { return false }
        return self.hasAccess == false && self.isPreview == false
    }
    private var displayedOfferType: AnalyticsPurchaseOfferType? {
        guard self.showsOffer, self.isTestOfferPreview == false, self.hasAccess == false, let offer = self.offer else { return nil }
        return offer.includesFreeTrial ? .freeTrial : .standard
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
                        .disabled(self.isPreview)
                        .accessibilityIdentifier(UITestIdentifier.premiumOwnKeyButton)
                    }
                }

                if self.showsOffer {
                    Section {
                        Text(self.offerHeading)
                            .font(.largeTitle.bold())
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.isHeader)
                            .onAppear {
                                self.presenter.recordShown(
                                    requestId: self.request.id,
                                    screen: analyticsSurface(tab: self.store.currentVisibleTab),
                                    store: self.store
                                )
                            }
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)

                    Section {
                        self.freePlan
                    }
                    .listRowSeparator(.hidden)

                    Section {
                        self.premiumPlan
                    }
                    .listRowBackground(Color.orange.opacity(0.10))
                    .listRowSeparator(.hidden)
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

                AppleSubscriptionControls(summaryEndDate: nil, isRestoreDisabled: false, onRestore: {
                    guard self.presenter.request?.id == self.request.id,
                          self.subscriptions.currentPurchases.isEmpty == false else { return }
                    self.presenter.awaitAppleConfirmation(requestId: self.request.id, identity: self.request.identity)
                    self.presenter.confirmAppleAccess(entitlement: self.store.cloudEntitlement, identity: try? self.store.appleSubscriptionIdentity())
                })
                .disabled(self.isPurchasing || self.isPreview)

                Section {
                    HStack(alignment: .top, spacing: 16) {
                        if let privacyURL = URL(string: flashcardsPrivacyPolicyUrl) {
                            Link(aiSettingsLocalized("common.privacyPolicy", "Privacy Policy"), destination: privacyURL)
                                .accessibilityIdentifier(UITestIdentifier.premiumPrivacyLink)
                        }
                        if let eulaURL = URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/") {
                            Link(aiSettingsLocalized("common.termsOfService", "Terms of Service"), destination: eulaURL)
                                .accessibilityIdentifier(UITestIdentifier.premiumEULALink)
                        }
                    }
                    .font(.footnote)
                    .buttonStyle(.borderless)
                    .fixedSize(horizontal: false, vertical: true)
                }
                .listRowBackground(Color.clear)
            }
            .listStyle(.insetGrouped)
            .listSectionSpacing(.compact)
            .contentMargins(.top, 8, for: .scrollContent)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle(self.isAILimit ? premiumAILimitTitle() : "Nibomo")
            .navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier(UITestIdentifier.premiumOfferSheet)
            .navigationDestination(for: PremiumNavigationDestination.self) { destination in
                switch destination {
                case .ownOpenAIKey:
                    OwnOpenAIKeySettingsView()
                        .toolbar { self.closeToolbar }
                }
            }
            .toolbar {
                if self.showsOffer == false {
                    self.closeToolbar
                }
            }
        }
        .onChange(of: self.displayedOfferType, initial: true) { _, offerType in
            self.presenter.updateDisplayedOffer(requestId: self.request.id, offerType: offerType)
        }
        .alert(aiSettingsLocalized("settings.test.title", "Test"), isPresented: self.$isPreviewPurchaseAlertPresented) {
            Button(aiSettingsLocalized("common.ok", "OK"), role: .cancel) {}
        } message: {
            Text(aiSettingsLocalized("premium.offer.previewPurchaseMessage", "This is a test preview. No purchase will be made."))
        }
        .task(id: self.loadAttempt) {
            self.isLoading = true
            self.errorMessage = nil
            self.offer = nil
            self.premiumAIAllowance = nil
            defer { self.isLoading = false }
            do {
                guard self.presenter.request?.id == self.request.id else { return }
                if self.isPreview {
                    try await self.loadStoreOffer()
                    if self.isTestOfferPreview {
                        guard let identity = self.request.identity else { throw AppleSubscriptionError.accountUnavailable }
                        let allowance = try await self.store.loadPremiumAIAllowance(identity: identity)
                        guard self.presenter.request?.id == self.request.id else { return }
                        self.premiumAIAllowance = allowance
                    }
                    return
                }
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
                let allowance = try await self.store.loadPremiumAIAllowance(identity: identity)
                try await self.loadStoreOffer()
                try self.store.requireAppleSubscriptionIdentity(identity)
                guard self.presenter.request?.id == self.request.id else { return }
                self.premiumAIAllowance = allowance
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

    private var offerHeading: AttributedString {
        var heading = AttributedString(localized: String.LocalizationValue(stringLiteral: aiSettingsLocalized(
            "premium.offer.heading", "Learning belongs to **everyone**."
        )))
        for run in heading.runs where run.inlinePresentationIntent?.contains(.stronglyEmphasized) == true {
            heading[run.range].foregroundColor = .orange
        }
        return heading
    }

    private var creatorSupport: AttributedString {
        var support = AttributedString(localized: String.LocalizationValue(stringLiteral: aiSettingsLocalized(
            "premium.offer.creatorSupport",
            "Your subscription helps Nibomo’s creator, [Kirill Markin](https://kirill-markin.com/), pay for servers and fuel the next update with coffee and pizza."
        )))
        for run in support.runs where run.link?.absoluteString == "https://kirill-markin.com/" {
            support[run.range].foregroundColor = .white
            support[run.range].underlineStyle = .single
        }
        return support
    }

    private var freePlan: some View {
        VStack(alignment: .leading, spacing: 12) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline) {
                    self.freeTitle.fixedSize(horizontal: true, vertical: false)
                    Spacer(minLength: 12)
                    self.alwaysFreeText.fixedSize(horizontal: true, vertical: false)
                }
                VStack(alignment: .leading, spacing: 4) {
                    self.freeTitle
                    self.alwaysFreeText
                }
            }
            Text(aiSettingsLocalized("premium.offer.freeDescription", "Created for students without a job. Open to everyone. Your backpack just got lighter."))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Label(aiSettingsLocalized("premium.offer.freeBenefits", "Core reviews, offline learning & sync"), systemImage: "checkmark")
                .font(.subheadline)
            Button {
                guard self.presenter.request?.id == self.request.id else { return }
                self.presenter.recordChoice(requestId: self.request.id, outcome: .free)
                self.presenter.finish(outcome: .continuedFree)
            } label: {
                HStack {
                    Text(aiSettingsLocalized("premium.offer.continueFree", "Continue free"))
                        .frame(maxWidth: .infinity)
                    Image(systemName: "arrow.forward").accessibilityHidden(true)
                }
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .accessibilityIdentifier(UITestIdentifier.premiumContinueFreeButton)
        }
        .padding(.vertical, 4)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var freeTitle: some View {
        Text(aiSettingsLocalized("premium.offer.free", "Free"))
            .font(.title3.bold())
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
    }

    private var alwaysFreeText: some View {
        Text(aiSettingsLocalized("premium.offer.alwaysFree", "Always free"))
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var premiumPlan: some View {
        VStack(alignment: .leading, spacing: 12) {
            if self.dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 4) {
                    self.premiumTitle
                    self.recurringPrice
                }
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    self.premiumTitle
                    Spacer(minLength: 0)
                    self.recurringPrice
                        .multilineTextAlignment(.trailing)
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                if let allowance = self.premiumAIAllowance {
                    Label(
                        allowance.premiumAiMonthlyMessages.map { count in
                            aiSettingsLocalizedFormat("premium.offer.monthlyAI", "%@ AI messages every month", count.formatted())
                        } ?? aiSettingsLocalized("premium.offer.unlimitedAI", "AI messages with no monthly cap"),
                        systemImage: "checkmark"
                    )
                }
                Label(aiSettingsLocalized("premium.offer.styles", "Custom colors and styles"), systemImage: "checkmark")
                if UIApplication.shared.supportsAlternateIcons {
                    Label(aiSettingsLocalized("settings.appIcon.title", "App icon"), systemImage: "checkmark")
                }
            }
            .font(.subheadline)

            Text(self.creatorSupport)
            .font(.subheadline)
            .foregroundStyle(.secondary)

            if self.isTestOfferPreview == false, self.hasAccess, let entitlement = self.store.cloudEntitlement {
                LabeledContent(aiSettingsLocalized("settings.subscription.plan", "Plan")) {
                    Text(entitlement.tierDisplayName)
                }
            }
            if self.offer != nil {
                if self.isTestOfferPreview || self.hasAccess == false {
                    Button {
                        self.purchase()
                    } label: {
                        HStack {
                            Text(self.purchaseTitle)
                                .frame(maxWidth: .infinity)
                            if self.isPurchasing {
                                ProgressView()
                            } else {
                                Image(systemName: "arrow.forward").accessibilityHidden(true)
                            }
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(self.isPurchasing || self.isLoading || self.canPurchase == false || self.premiumAIAllowance == nil)
                    .accessibilityIdentifier(UITestIdentifier.premiumPurchaseButton)
                }
                VStack(spacing: 4) {
                    if self.canPurchase, let trialText {
                        Text("\(trialText) \(self.priceText)")
                    }
                    Text(aiSettingsLocalized("premium.apple.renewal", "Auto-renews. Manage or cancel in App Store subscriptions."))
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
            }
        }
        .padding(.vertical, 4)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var premiumTitle: some View {
        HStack(spacing: 6) {
            Text(premiumOfferTitle())
            Image(systemName: "sparkles")
                .foregroundStyle(.orange)
                .accessibilityHidden(true)
        }
        .font(.title3.bold())
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    @ViewBuilder
    private var recurringPrice: some View {
        if self.offer != nil {
            Text(self.priceText)
                .font(.subheadline.bold())
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier(UITestIdentifier.premiumPrice)
        }
    }

    @ToolbarContentBuilder
    private var closeToolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                guard self.presenter.request?.id == self.request.id else { return }
                self.presenter.finish(outcome: .dismissed)
            } label: {
                Label(aiSettingsLocalized("common.close", "Close"), systemImage: "xmark")
                    .labelStyle(.iconOnly)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
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

    @MainActor
    private func loadStoreOffer() async throws {
        let offer = try await self.subscriptions.loadOffer()
        guard let subscription = offer.product.subscription else { throw AppleSubscriptionError.productUnavailable }
        let period = try appleSubscriptionPeriodText(period: subscription.subscriptionPeriod, count: 1)
        var trial: String? = nil
        var title = aiSettingsLocalized("premium.offer.subscribe", "Subscribe")
        if offer.includesFreeTrial, let intro = subscription.introductoryOffer {
            let duration = try appleSubscriptionPeriodText(period: intro.period, count: intro.periodCount)
            trial = aiSettingsLocalizedFormat("premium.apple.trial", "%@ free, then", duration)
            title = aiSettingsLocalizedFormat("premium.offer.startTrial", "Start free trial: %@", duration)
        }
        guard self.presenter.request?.id == self.request.id else { return }
        self.offer = offer
        self.priceText = "\(offer.displayPrice) / \(period)"
        self.trialText = trial
        self.purchaseTitle = title
    }

    private func purchase() {
        guard self.isPurchasing == false, self.isLoading == false, self.canPurchase,
              self.premiumAIAllowance != nil, let offer = self.offer,
              self.presenter.request?.id == self.request.id else { return }
        if self.isTestOfferPreview {
            self.isPreviewPurchaseAlertPresented = true
            return
        }
        self.presenter.recordChoice(requestId: self.request.id, outcome: .premium)
        self.isPurchasing = true
        self.message = nil
        self.errorMessage = nil
        self.presenter.awaitAppleConfirmation(requestId: self.request.id, identity: self.request.identity)
        Task { @MainActor in
            defer { self.isPurchasing = false }
            do {
                guard let identity = self.request.identity else { throw AppleSubscriptionError.accountUnavailable }
                try self.store.requireAppleSubscriptionIdentity(identity)
                let result = try await self.subscriptions.purchasePremium(offer: offer, presentation: self.request.analyticsPresentation)
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
