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
    @Environment(\.isLowPowerModeEnabled) private var isLowPowerModeEnabled: Bool

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
                            .disabled(self.isLowPowerModeEnabled || assetStatus == .pending)
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
                onEventFinished: self.removeFinishedReviewReactionEvent(eventId:)
            )
        }
        .navigationTitle(aiSettingsLocalized("settings.test.animations.title", "Animations"))
        .onAppear {
            self.prewarmReviewReactionLottieAssets()
        }
        .onChange(of: self.isLowPowerModeEnabled) { _, isEnabled in
            if isEnabled {
                self.cancelReviewReactionLottiePrewarm()
                self.activeReviewReactionEvents = []
            } else {
                self.prewarmReviewReactionLottieAssets()
            }
        }
        .onDisappear {
            self.cancelReviewReactionLottiePrewarm()
        }
    }

    private func prewarmReviewReactionLottieAssets() {
        guard self.isLowPowerModeEnabled == false else {
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
        guard self.isLowPowerModeEnabled == false else {
            return
        }
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
    case .ready, .failed, .notLottie:
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
    }
}

#Preview("Animations") {
    NavigationStack {
        TestAnimationsView()
    }
}
