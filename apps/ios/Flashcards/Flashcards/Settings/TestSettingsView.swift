import SwiftUI
import UIKit

struct TestSettingsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(PremiumPresenter.self) private var premiumPresenter: PremiumPresenter

    var body: some View {
        List {
            Section(aiSettingsLocalized("settings.test.section.tools", "Tools")) {
                NavigationLink(value: SettingsNavigationDestination.testAnimations) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.test.animations", "Animations"),
                        value: aiSettingsLocalized("settings.test.animations.itemCount", "38 items"),
                        systemImage: "sparkles",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.testSettingsAnimationsRow)

                NavigationLink(value: SettingsNavigationDestination.notificationDiagnostics) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized(
                            "settings.test.notificationDiagnostics",
                            "Notification Diagnostics"
                        ),
                        value: aiSettingsLocalized(
                            "settings.test.notificationDiagnostics.value",
                            "Read-only"
                        ),
                        systemImage: "bell.badge",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.testSettingsNotificationDiagnosticsRow)

                NavigationLink(value: SettingsNavigationDestination.localSyncDiagnostics) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized(
                            "settings.test.localSyncDiagnostics",
                            "Local Sync Diagnostics"
                        ),
                        value: aiSettingsLocalized(
                            "settings.test.localSyncDiagnostics.value",
                            "Read-only"
                        ),
                        systemImage: "externaldrive.badge.icloud",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.testSettingsLocalSyncDiagnosticsRow)

                Button {
                    store.presentTechnicalErrorPreview()
                } label: {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized(
                            "settings.test.technicalErrorPreview",
                            "Technical error preview"
                        ),
                        value: aiSettingsLocalized(
                            "settings.test.technicalErrorPreview.value",
                            "Preview sheet"
                        ),
                        systemImage: "exclamationmark.triangle",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.testSettingsTechnicalErrorPreviewRow)

                Button {
                    self.premiumPresenter.present(reason: .offerPreview, analyticsEntryPoint: nil, entitlement: store.cloudEntitlement, identity: try? store.appleSubscriptionIdentity())
                } label: {
                    SettingsNavigationRow(
                        title: premiumOfferTitle(),
                        value: aiSettingsLocalized("settings.test.technicalErrorPreview.value", "Preview sheet"),
                        systemImage: "sparkles",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.testSettingsPremiumPreview)

                Button {
                    self.premiumPresenter.present(reason: .aiLimit, analyticsEntryPoint: nil, entitlement: store.cloudEntitlement, identity: try? store.appleSubscriptionIdentity())
                } label: {
                    SettingsNavigationRow(
                        title: premiumAILimitTitle(),
                        value: aiSettingsLocalized("settings.test.technicalErrorPreview.value", "Preview sheet"),
                        systemImage: "bubble.left",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.testSettingsAILimitPreview)

                Button {
                    store.clearStoreReviewPromptStateForTests()
                } label: {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.test.storeReviewPromptReset", "Reset App Store review prompt"),
                        value: aiSettingsLocalized("settings.test.storeReviewPromptReset.value", "Local state"),
                        systemImage: "star.bubble",
                        attentionCount: nil
                    )
                }
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.testSettingsScreen)
        .navigationTitle(aiSettingsLocalized("settings.test.title", "Test"))
    }
}

struct TestAnimationsView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.isLowPowerModeEnabled) private var isLowPowerModeEnabled: Bool

    @State private var isReviewReactionScreenVisible: Bool = false
    @State private var reviewReactionLottiePrewarmTask: Task<Void, Never>?
    @State private var reviewReactionLottiePrewarmId: UUID?
    @State private var reviewReactionLottieAssetStore: ReviewReactionLottieAssetStore = makePendingReviewReactionLottieAssetStore()
    @State private var activeReviewReactionEvents: [ReviewReactionEvent] = []

    var body: some View {
        ZStack {
            List {
                ForEach(ReviewReactionRating.allCases, id: \.self) { rating in
                    Section(localizedReviewReactionRatingTitle(rating: rating)) {
                        ForEach(reviewReactionVariantDistributionEntries(rating: rating)) { entry in
                            let assetStatus: ReviewReactionLottieAssetStatus = self.assetStatus(entry: entry)
                            Button {
                                self.playAnimation(entry: entry)
                            } label: {
                                HStack(spacing: 12) {
                                    Text(entry.variant.debugIdentifier)
                                        .font(.body.monospaced())
                                        .foregroundStyle(.primary)

                                    Spacer(minLength: 0)

                                    Text(
                                        testAnimationDetailText(
                                            entry: entry,
                                            assetStatus: assetStatus,
                                            isLowPowerModeEnabled: self.isLowPowerModeEnabled
                                        )
                                    )
                                        .font(.subheadline.monospacedDigit())
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .disabled(self.isLowPowerModeEnabled || assetStatus != .ready)
                            .accessibilityLabel(
                                testAnimationAccessibilityLabel(
                                    entry: entry,
                                    assetStatus: assetStatus,
                                    isLowPowerModeEnabled: self.isLowPowerModeEnabled
                                )
                            )
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .accessibilityIdentifier(UITestIdentifier.testAnimationsScreen)

            ReviewReactionLayer(
                events: self.activeReviewReactionEvents,
                lottieAssetStore: self.reviewReactionLottieAssetStore,
                source: .testAnimations,
                onEventFinished: self.removeFinishedReviewReactionEvent(eventId:action:reason:)
            )
        }
        .navigationTitle(aiSettingsLocalized("settings.test.animations.title", "Animations"))
        .onAppear {
            self.isReviewReactionScreenVisible = true
            self.prewarmReviewReactionLottieAssets()
        }
        .onChange(of: self.isLowPowerModeEnabled) { _, isEnabled in
            if isEnabled {
                self.cancelReviewReactionLottiePrewarm()
                self.dismissActiveReviewReactions(reason: "low_power_mode")
            } else {
                self.prewarmReviewReactionLottieAssets()
            }
        }
        .onChange(of: self.scenePhase) { _, phase in
            if phase == .active {
                self.prewarmReviewReactionLottieAssets()
            } else {
                self.cancelReviewReactionLottiePrewarm()
                self.dismissActiveReviewReactions(reason: "scene_inactive")
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didReceiveMemoryWarningNotification)) { _ in
            self.cancelReviewReactionLottiePrewarm()
            self.dismissActiveReviewReactions(reason: "memory_warning")
        }
        .onDisappear {
            self.isReviewReactionScreenVisible = false
            self.cancelReviewReactionLottiePrewarm()
            self.dismissActiveReviewReactions(reason: "screen_disappeared")
        }
    }

    private func prewarmReviewReactionLottieAssets() {
        guard self.isReviewReactionScreenVisible, self.isLowPowerModeEnabled == false, self.scenePhase == .active else {
            return
        }
        guard self.reviewReactionLottiePrewarmTask == nil else {
            return
        }
        let pendingVariants: Set<ReviewReactionVariant> = self.reviewReactionLottieAssetStore.pendingVariants
        guard pendingVariants.isEmpty == false else {
            return
        }

        let prewarmId = UUID()
        self.reviewReactionLottiePrewarmId = prewarmId
        self.reviewReactionLottiePrewarmTask = startReviewReactionLottieAssetPrewarm(
            pendingVariants: pendingVariants,
            onLoadResult: { loadResult in
                guard self.reviewReactionLottiePrewarmId == prewarmId else { return }
                if case .failed(let failure) = loadResult,
                   self.reviewReactionLottieAssetStore.failedAssets[failure.variant] == nil {
                    FlashcardsObservability.captureReviewReactionFailure(failure: failure, source: .testAnimations)
                }
                self.reviewReactionLottieAssetStore = self.reviewReactionLottieAssetStore.recordingLoadResult(
                    loadResult: loadResult
                )
            },
            onCompletion: {
                self.finishReviewReactionLottiePrewarm(prewarmId: prewarmId)
            }
        )
    }

    private func cancelReviewReactionLottiePrewarm() {
        self.reviewReactionLottiePrewarmTask?.cancel()
        self.reviewReactionLottiePrewarmTask = nil
        self.reviewReactionLottiePrewarmId = nil
    }

    private func finishReviewReactionLottiePrewarm(prewarmId: UUID) {
        guard self.reviewReactionLottiePrewarmId == prewarmId else {
            return
        }

        self.reviewReactionLottiePrewarmTask = nil
        self.reviewReactionLottiePrewarmId = nil
    }

    private func playAnimation(entry: ReviewReactionVariantDistributionEntry) {
        guard self.isReviewReactionScreenVisible, self.isLowPowerModeEnabled == false, self.scenePhase == .active else {
            return
        }
        guard self.assetStatus(entry: entry) == .ready else {
            FlashcardsObservability.recordReviewReaction(
                action: .skip, variant: entry.variant, source: .testAnimations, reason: "asset_not_ready"
            )
            return
        }

        let event = ReviewReactionEvent(
            id: UUID(),
            rating: entry.rating,
            variant: entry.variant
        )
        self.dismissActiveReviewReactions(reason: "replacement")
        self.activeReviewReactionEvents = [event]
    }

    private func dismissActiveReviewReactions(reason: String) {
        for event in self.activeReviewReactionEvents {
            FlashcardsObservability.recordReviewReaction(
                action: .cancel, variant: event.variant, source: .testAnimations, reason: reason
            )
        }
        self.activeReviewReactionEvents = []
    }

    private func removeFinishedReviewReactionEvent(
        eventId: UUID, action: ReviewReactionLifecycleAction, reason: String
    ) {
        guard let event = self.activeReviewReactionEvents.first(where: { $0.id == eventId }) else { return }
        FlashcardsObservability.recordReviewReaction(
            action: action, variant: event.variant, source: .testAnimations, reason: reason
        )
        self.activeReviewReactionEvents.removeAll { $0.id == eventId }
    }

    private func assetStatus(entry: ReviewReactionVariantDistributionEntry) -> ReviewReactionLottieAssetStatus {
        reviewReactionLottieAssetStatus(
            variant: entry.variant,
            readiness: self.reviewReactionLottieAssetStore.readiness
        )
    }
}

private func localizedReviewReactionRatingTitle(rating: ReviewReactionRating) -> String {
    switch rating {
    case .again:
        return localizedReviewRatingTitle(rating: .again)
    case .hard:
        return localizedReviewRatingTitle(rating: .hard)
    case .good:
        return localizedReviewRatingTitle(rating: .good)
    case .easy:
        return localizedReviewRatingTitle(rating: .easy)
    }
}

private func testAnimationProbabilityText(entry: ReviewReactionVariantDistributionEntry) -> String {
    let percentText: String = "\(Int(entry.probabilityPercent.rounded()))%"
    return aiSettingsLocalizedFormat(
        "settings.test.animations.probability",
        "%@ probability",
        percentText
    )
}

private func testAnimationDetailText(
    entry: ReviewReactionVariantDistributionEntry,
    assetStatus: ReviewReactionLottieAssetStatus,
    isLowPowerModeEnabled: Bool
) -> String {
    if isLowPowerModeEnabled {
        return aiSettingsLocalized(
            "settings.reviewAnimations.lowPowerMode.paused",
            "Paused by Low Power Mode"
        )
    }

    switch assetStatus {
    case .pending:
        return aiSettingsLocalized("common.loading", "Loading...")
    case .failed, .notLottie:
        return aiSettingsLocalized("common.unavailable", "Unavailable")
    case .ready:
        return testAnimationProbabilityText(entry: entry)
    }
}

private func testAnimationAccessibilityLabel(
    entry: ReviewReactionVariantDistributionEntry,
    assetStatus: ReviewReactionLottieAssetStatus,
    isLowPowerModeEnabled: Bool
) -> String {
    aiSettingsLocalizedFormat(
        "settings.test.animations.playAccessibility",
        "Play %@ animation, %@",
        entry.variant.debugIdentifier,
        testAnimationDetailText(
            entry: entry,
            assetStatus: assetStatus,
            isLowPowerModeEnabled: isLowPowerModeEnabled
        )
    )
}

#Preview("Test") {
    NavigationStack {
        TestSettingsView()
            .environment(FlashcardsStore())
            .environment(PremiumPresenter())
    }
}

#Preview("Animations") {
    NavigationStack {
        TestAnimationsView()
    }
}
