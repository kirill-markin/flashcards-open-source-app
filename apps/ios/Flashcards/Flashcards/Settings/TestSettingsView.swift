import SwiftUI

struct TestSettingsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

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
    @State private var hasStartedReviewReactionLottiePrewarm: Bool = false
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

                                    Text(testAnimationDetailText(entry: entry, assetStatus: assetStatus))
                                        .font(.subheadline.monospacedDigit())
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .disabled(assetStatus == .pending)
                            .accessibilityLabel(testAnimationAccessibilityLabel(entry: entry, assetStatus: assetStatus))
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .accessibilityIdentifier(UITestIdentifier.testAnimationsScreen)

            ReviewReactionLayer(
                events: self.activeReviewReactionEvents,
                lottieAssetStore: self.reviewReactionLottieAssetStore,
                onEventFinished: self.removeFinishedReviewReactionEvent(eventId:)
            )
        }
        .navigationTitle(aiSettingsLocalized("settings.test.animations.title", "Animations"))
        .onAppear {
            self.prewarmReviewReactionLottieAssets()
        }
    }

    private func prewarmReviewReactionLottieAssets() {
        if self.hasStartedReviewReactionLottiePrewarm {
            return
        }

        self.hasStartedReviewReactionLottiePrewarm = true
        startReviewReactionLottieAssetPrewarm { loadResult in
            self.reviewReactionLottieAssetStore = self.reviewReactionLottieAssetStore.recordingLoadResult(
                loadResult: loadResult
            )
        }
    }

    private func playAnimation(entry: ReviewReactionVariantDistributionEntry) {
        guard self.assetStatus(entry: entry) != .pending else {
            return
        }

        let event = ReviewReactionEvent(
            id: UUID(),
            rating: entry.rating,
            variant: entry.variant
        )
        self.activeReviewReactionEvents = appendReviewReactionEvent(
            events: self.activeReviewReactionEvents,
            event: event,
            maximumActiveEvents: reviewReactionMaximumActiveEvents
        )
    }

    private func removeFinishedReviewReactionEvent(eventId: UUID) {
        self.activeReviewReactionEvents = self.activeReviewReactionEvents.filter { activeEvent in
            activeEvent.id != eventId
        }
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
    assetStatus: ReviewReactionLottieAssetStatus
) -> String {
    switch assetStatus {
    case .pending:
        return aiSettingsLocalized("common.loading", "Loading...")
    case .ready, .failed, .notLottie:
        return testAnimationProbabilityText(entry: entry)
    }
}

private func testAnimationAccessibilityLabel(
    entry: ReviewReactionVariantDistributionEntry,
    assetStatus: ReviewReactionLottieAssetStatus
) -> String {
    aiSettingsLocalizedFormat(
        "settings.test.animations.playAccessibility",
        "Play %@ animation, %@",
        entry.variant.debugIdentifier,
        testAnimationDetailText(entry: entry, assetStatus: assetStatus)
    )
}

#Preview("Test") {
    NavigationStack {
        TestSettingsView()
            .environment(FlashcardsStore())
    }
}

#Preview("Animations") {
    NavigationStack {
        TestAnimationsView()
    }
}
