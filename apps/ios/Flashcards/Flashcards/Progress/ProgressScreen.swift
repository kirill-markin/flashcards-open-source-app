import SwiftUI

struct ProgressScreen: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 20) {
                if self.store.progressErrorMessage.isEmpty == false {
                    CopyableErrorMessageView(message: self.store.progressErrorMessage)
                        .modifier(ProgressCardModifier())
                }

                if let progressSnapshot = self.store.progressSnapshot {
                    let presentationCalendar = requiredProgressPresentationCalendar(
                        timeZoneIdentifier: progressSnapshot.scopeKey.timeZone
                    )
                    let streakWeeks = requiredProgressStreakWeeks(
                        progressSnapshot: progressSnapshot,
                        calendar: presentationCalendar
                    )
                    VStack(alignment: .leading, spacing: 12) {
                        Text(
                            String(
                                localized: "progress.screen.streak.section_title",
                                defaultValue: "Streak",
                                table: progressStringsTableName,
                                comment: "Progress streak section title"
                            )
                        )
                        .font(.headline)

                        ProgressStreakSection(
                            weeks: streakWeeks,
                            badgeState: makeReviewProgressBadgeState(summary: progressSnapshot.summary),
                            calendar: presentationCalendar
                        )
                    }
                    .accessibilityIdentifier(UITestIdentifier.progressStreakSection)
                    .accessibilityValue(progressSummaryUITestValue(summary: progressSnapshot.summary))
                    .modifier(ProgressCardModifier())

                    VStack(alignment: .leading, spacing: 0) {
                        ProgressReviewsSection(
                            chartDays: progressSnapshot.chartData.chartDays,
                            chartCalendar: presentationCalendar,
                            selectionResetKey: progressSnapshot.scopeKey.storageKey
                        )
                    }
                    .accessibilityIdentifier(UITestIdentifier.progressReviewsSection)
                    .modifier(ProgressCardModifier())

                    if let reviewScheduleSnapshot = self.store.reviewScheduleSnapshot {
                        VStack(alignment: .leading, spacing: 0) {
                            ProgressReviewScheduleSection(snapshot: reviewScheduleSnapshot)
                        }
                        .accessibilityIdentifier(UITestIdentifier.progressReviewScheduleSection)
                        .modifier(ProgressCardModifier())
                    }
                } else if self.store.isProgressRefreshing == false {
                    VStack(alignment: .leading, spacing: 0) {
                        ContentUnavailableView(
                            String(
                                localized: "progress.screen.unavailable.title",
                                defaultValue: "Progress is unavailable",
                                table: progressStringsTableName,
                                comment: "Progress unavailable title"
                            ),
                            systemImage: "chart.bar.xaxis",
                            description: Text(
                                String(
                                    localized: "progress.screen.unavailable.description",
                                    defaultValue: "Open review or reconnect cloud data, then refresh progress.",
                                    table: progressStringsTableName,
                                    comment: "Progress unavailable description"
                                )
                            )
                        )
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .modifier(ProgressCardModifier())
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 20)
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .accessibilityIdentifier(UITestIdentifier.progressScreen)
        .navigationTitle(
            String(
                localized: "progress.screen.title",
                defaultValue: "Progress",
                table: progressStringsTableName,
                comment: "Progress screen title"
            )
        )
        .refreshable {
            await self.store.refreshProgressManually()
        }
    }
}

private func progressSummaryUITestValue(summary: ProgressSummary) -> String {
    let components: [String] = [
        "currentStreakDays=\(summary.currentStreakDays)",
        "hasReviewedToday=\(summary.hasReviewedToday ? "true" : "false")",
        "activeReviewDays=\(summary.activeReviewDays)"
    ]
    return components.joined(separator: ";")
}

private struct ProgressCardModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color(uiColor: .secondarySystemGroupedBackground))
            )
    }
}

#Preview {
    NavigationStack {
        ProgressScreen()
            .environment(FlashcardsStore())
    }
}
