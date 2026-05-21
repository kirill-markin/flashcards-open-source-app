import SwiftUI

struct TestSettingsView: View {
    var body: some View {
        List {
            Section(aiSettingsLocalized("settings.test.section.tools", "Tools")) {
                NavigationLink(value: SettingsNavigationDestination.testAnimations) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.test.animations", "Animations"),
                        value: aiSettingsLocalized("settings.test.animations.itemCount", "16 items"),
                        systemImage: "sparkles"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.testSettingsAnimationsRow)
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.testSettingsScreen)
        .navigationTitle(aiSettingsLocalized("settings.test.title", "Test"))
    }
}

struct TestAnimationsView: View {
    @Environment(\.accessibilityReduceMotion) private var isReduceMotionEnabled
    @State private var activeReviewReactionEvents: [ReviewReactionEvent] = []

    private var reviewReactionMotionMode: ReviewReactionMotionMode {
        self.isReduceMotionEnabled ? .reduced : .standard
    }

    var body: some View {
        ZStack {
            List {
                ForEach(ReviewReactionRating.allCases, id: \.self) { rating in
                    Section(localizedReviewReactionRatingTitle(rating: rating)) {
                        ForEach(reviewReactionVariantDistributionEntries(rating: rating)) { entry in
                            Button {
                                self.playAnimation(entry: entry)
                            } label: {
                                HStack(spacing: 12) {
                                    Text(entry.variant.debugIdentifier)
                                        .font(.body.monospaced())
                                        .foregroundStyle(.primary)

                                    Spacer(minLength: 0)

                                    Text(testAnimationProbabilityText(entry: entry))
                                        .font(.subheadline.monospacedDigit())
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .accessibilityLabel(testAnimationAccessibilityLabel(entry: entry))
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .accessibilityIdentifier(UITestIdentifier.testAnimationsScreen)

            ReviewReactionLayer(events: self.activeReviewReactionEvents)
        }
        .navigationTitle(aiSettingsLocalized("settings.test.animations.title", "Animations"))
    }

    private func playAnimation(entry: ReviewReactionVariantDistributionEntry) {
        let event = ReviewReactionEvent(
            id: UUID(),
            rating: entry.rating,
            variant: entry.variant
        )
        let motionMode: ReviewReactionMotionMode = self.reviewReactionMotionMode
        self.activeReviewReactionEvents = appendReviewReactionEvent(
            events: self.activeReviewReactionEvents,
            event: event,
            maximumActiveEvents: reviewReactionMaximumActiveEvents
        )

        Task { @MainActor in
            await self.removeAnimationEventAfterDelay(
                event: event,
                motionMode: motionMode
            )
        }
    }

    private func removeAnimationEventAfterDelay(
        event: ReviewReactionEvent,
        motionMode: ReviewReactionMotionMode
    ) async {
        do {
            try await Task.sleep(
                nanoseconds: reviewReactionCleanupDelayNanoseconds(
                    variant: event.variant,
                    motionMode: motionMode
                )
            )
        } catch is CancellationError {
            return
        } catch {
            preconditionFailure("Unexpected test animation cleanup sleep error: \(error).")
        }

        self.activeReviewReactionEvents = self.activeReviewReactionEvents.filter { activeEvent in
            activeEvent.id != event.id
        }
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
    let percentText: String = "\(Int(entry.probabilityPercent))%"
    return aiSettingsLocalizedFormat(
        "settings.test.animations.probability",
        "%@ probability",
        percentText
    )
}

private func testAnimationAccessibilityLabel(entry: ReviewReactionVariantDistributionEntry) -> String {
    aiSettingsLocalizedFormat(
        "settings.test.animations.playAccessibility",
        "Play %@ animation, %@",
        entry.variant.debugIdentifier,
        testAnimationProbabilityText(entry: entry)
    )
}

#Preview("Test") {
    NavigationStack {
        TestSettingsView()
    }
}

#Preview("Animations") {
    NavigationStack {
        TestAnimationsView()
    }
}
