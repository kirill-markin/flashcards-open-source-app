import Charts
import SwiftUI

private let progressLeaderboardProfileActivityChartHeight: CGFloat = 180

private enum ProgressLeaderboardProfileLoadState: Hashable {
    case loading
    case loaded(UserProgressLeaderboardProfile)
    case failed(String)
}

struct ProgressLeaderboardProfileSheet: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(\.dismiss) private var dismiss

    let selectedProfile: ProgressLeaderboardSelectedProfile

    @State private var loadState: ProgressLeaderboardProfileLoadState = .loading

    var body: some View {
        NavigationStack {
            self.content
                .navigationTitle(self.navigationTitle)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(
                            String(
                                localized: "progress.leaderboard_profile.done_button",
                                defaultValue: "Done",
                                table: progressStringsTableName,
                                comment: "Toolbar button title for dismissing a leaderboard profile sheet"
                            )
                        ) {
                            self.dismiss()
                        }
                    }
                }
        }
        .accessibilityIdentifier(UITestIdentifier.progressLeaderboardProfileSheet)
        .task(id: self.selectedProfile.publicProfileId) {
            await self.loadProfile()
        }
    }

    @ViewBuilder
    private var content: some View {
        switch self.loadState {
        case .loading:
            ProgressLeaderboardProfileLoadingView(selectedProfile: self.selectedProfile)
        case .loaded(let profile):
            self.loadedContent(profile: profile)
        case .failed(let message):
            ProgressLeaderboardProfileErrorView(
                message: message,
                onRetry: {
                    Task {
                        await self.loadProfile()
                    }
                }
            )
        }
    }

    @ViewBuilder
    private func loadedContent(profile: UserProgressLeaderboardProfile) -> some View {
        switch profile.status {
        case .ready:
            if let readyPayload = profile.readyPayload {
                ProgressLeaderboardProfileReadyView(
                    selectedProfile: self.selectedProfile,
                    profile: readyPayload
                )
            } else {
                ProgressLeaderboardProfileUnavailableView(status: .profileUnavailable)
            }
        case .linkedAccountRequired, .participationDisabled, .profileUnavailable:
            ProgressLeaderboardProfileUnavailableView(status: profile.status)
        }
    }

    private var navigationTitle: String {
        if self.selectedProfile.isViewer {
            return progressLeaderboardViewerRowTitle()
        }

        guard case .loaded(let profile) = self.loadState,
              let readyPayload = profile.readyPayload else {
            return progressLeaderboardProfileDisplayName(
                anonymousDisplayName: self.selectedProfile.anonymousDisplayName,
                friendDisplayName: self.selectedProfile.friendDisplayName
            )
        }

        return progressLeaderboardProfileDisplayName(
            anonymousDisplayName: readyPayload.anonymousDisplayName,
            friendDisplayName: readyPayload.friendDisplayName
        )
    }

    @MainActor
    private func loadProfile() async {
        self.loadState = .loading

        do {
            self.loadState = .loaded(
                try await self.store.loadProgressLeaderboardProfile(
                    publicProfileId: self.selectedProfile.publicProfileId
                )
            )
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }

            self.loadState = .failed(Flashcards.errorMessage(error: error))
        }
    }
}

private struct ProgressLeaderboardProfileLoadingView: View {
    let selectedProfile: ProgressLeaderboardSelectedProfile

    var body: some View {
        VStack(spacing: 20) {
            if self.selectedProfile.isViewer {
                VStack(alignment: .center, spacing: 8) {
                    Text(progressLeaderboardViewerRowTitle())
                        .font(.title2.bold())
                        .foregroundStyle(.primary)

                    Text(self.selectedProfile.anonymousDisplayName)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }

            VStack(spacing: 12) {
                ProgressView()

                Text(
                    String(
                        localized: "progress.leaderboard_profile.loading",
                        defaultValue: "Loading profile...",
                        table: progressStringsTableName,
                        comment: "Loading message for a leaderboard profile sheet"
                    )
                )
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier(UITestIdentifier.progressLeaderboardProfileLoading)
    }
}

private struct ProgressLeaderboardProfileReadyView: View {
    let selectedProfile: ProgressLeaderboardSelectedProfile
    let profile: ProgressLeaderboardProfileReadyPayload

    var body: some View {
        Form {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(self.displayName)
                        .font(.title2.bold())
                        .foregroundStyle(.primary)

                    if self.shouldShowFriendBadge {
                        Label(
                            progressLeaderboardProfileFriendBadgeTitle(),
                            systemImage: "person.fill"
                        )
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    }

                    if let secondaryAnonymousDisplayName {
                        Text(secondaryAnonymousDisplayName)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
            }

            Section {
                LabeledContent {
                    Text(progressStreakLeaderboardDayCountText(streakDays: self.profile.metrics.currentStreakDays))
                } label: {
                    Text(
                        String(
                            localized: "progress.leaderboard_profile.current_streak.label",
                            defaultValue: "Current streak",
                            table: progressStringsTableName,
                            comment: "Leaderboard profile current streak metric label"
                        )
                    )
                }

                LabeledContent {
                    Text(
                        progressLeaderboardProfileBestRatingText(
                            placement: self.profile.metrics.bestRatingPlacement
                        )
                    )
                } label: {
                    Text(
                        String(
                            localized: "progress.leaderboard_profile.best_rating.label",
                            defaultValue: "Best rating",
                            table: progressStringsTableName,
                            comment: "Leaderboard profile best rating metric label"
                        )
                    )
                }
            } header: {
                Text(
                    String(
                        localized: "progress.leaderboard_profile.metrics.section_title",
                        defaultValue: "Metrics",
                        table: progressStringsTableName,
                        comment: "Leaderboard profile metrics section title"
                    )
                )
            }

            Section {
                ProgressLeaderboardProfileActivityChart(days: self.profile.reviewActivity.days)
            } header: {
                Text(
                    String(
                        localized: "progress.leaderboard_profile.activity.section_title",
                        defaultValue: "Review activity",
                        table: progressStringsTableName,
                        comment: "Leaderboard profile review activity section title"
                    )
                )
            } footer: {
                Text(
                    String(
                        localized: "progress.leaderboard_profile.activity.footer",
                        defaultValue: "Last 30 days.",
                        table: progressStringsTableName,
                        comment: "Leaderboard profile review activity footer"
                    )
                )
            }

            Section {
                LabeledContent {
                    Text(progressLeaderboardProfileJoinedDateText(joinedAt: self.profile.stats.joinedAt))
                } label: {
                    Text(
                        String(
                            localized: "progress.leaderboard_profile.joined.label",
                            defaultValue: "Joined",
                            table: progressStringsTableName,
                            comment: "Leaderboard profile joined date stats label"
                        )
                    )
                }

                LabeledContent {
                    Text(progressLeaderboardProfileCardCountText(totalCards: self.profile.stats.totalCards))
                } label: {
                    Text(
                        String(
                            localized: "progress.leaderboard_profile.cards.label",
                            defaultValue: "Cards",
                            table: progressStringsTableName,
                            comment: "Leaderboard profile total cards stats label"
                        )
                    )
                }
            } header: {
                Text(
                    String(
                        localized: "progress.leaderboard_profile.stats.section_title",
                        defaultValue: "Stats",
                        table: progressStringsTableName,
                        comment: "Leaderboard profile stats section title"
                    )
                )
            }
        }
        .accessibilityIdentifier(UITestIdentifier.progressLeaderboardProfileReady)
    }

    private var displayName: String {
        if self.selectedProfile.isViewer {
            return progressLeaderboardViewerRowTitle()
        }

        return progressLeaderboardProfileDisplayName(
            anonymousDisplayName: self.profile.anonymousDisplayName,
            friendDisplayName: self.profile.friendDisplayName
        )
    }

    private var secondaryAnonymousDisplayName: String? {
        if self.selectedProfile.isViewer || self.profile.friendDisplayName != nil {
            return self.profile.anonymousDisplayName
        }

        return nil
    }

    private var shouldShowFriendBadge: Bool {
        self.selectedProfile.isViewer == false && self.profile.isFriend
    }
}

private struct ProgressLeaderboardProfileActivityChart: View {
    let days: [ProgressLeaderboardProfileReviewActivityDay]

    private var chartDays: [ProgressLeaderboardProfileActivityChartDay] {
        self.days.map { day in
            ProgressLeaderboardProfileActivityChartDay(day: day)
        }
    }

    var body: some View {
        Chart {
            ForEach(self.chartDays) { day in
                BarMark(
                    x: .value(self.dateAxisTitle, day.date, unit: .day),
                    y: .value(self.reviewAxisTitle, day.reviewCount)
                )
                .foregroundStyle(Color.accentColor)
                .accessibilityLabel(progressLeaderboardProfileActivityDateLabel(date: day.localDate))
                .accessibilityValue(self.reviewCountText(reviewCount: day.reviewCount))
            }
        }
        .chartLegend(.hidden)
        .chartXAxis {
            AxisMarks(values: .stride(by: .day, count: 7)) {
                AxisGridLine()
                AxisTick()
                AxisValueLabel()
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading)
        }
        .frame(height: progressLeaderboardProfileActivityChartHeight)
        .accessibilityLabel(
            String(
                localized: "progress.leaderboard_profile.activity.chart.accessibility_label",
                defaultValue: "Review activity",
                table: progressStringsTableName,
                comment: "Accessibility label for the leaderboard profile review activity chart"
            )
        )
    }

    private var dateAxisTitle: String {
        String(
            localized: "progress.leaderboard_profile.activity.chart.date_axis",
            defaultValue: "Date",
            table: progressStringsTableName,
            comment: "Leaderboard profile review activity chart date axis label"
        )
    }

    private var reviewAxisTitle: String {
        String(
            localized: "progress.leaderboard_profile.activity.chart.review_axis",
            defaultValue: "Reviews",
            table: progressStringsTableName,
            comment: "Leaderboard profile review activity chart review count axis label"
        )
    }

    private func reviewCountText(reviewCount: Int) -> String {
        if reviewCount == 1 {
            return String(
                localized: "progress.leaderboard_profile.activity.review_count.one",
                defaultValue: "1 review",
                table: progressStringsTableName,
                comment: "Leaderboard profile activity singular review count"
            )
        }

        let localizedFormat = String(
            localized: "progress.leaderboard_profile.activity.review_count.other",
            defaultValue: "%lld reviews",
            table: progressStringsTableName,
            comment: "Leaderboard profile activity plural review count"
        )
        return String(format: localizedFormat, locale: Locale.current, Int64(reviewCount))
    }
}

private struct ProgressLeaderboardProfileActivityChartDay: Identifiable {
    let localDate: String
    let date: Date
    let reviewCount: Int

    var id: String {
        self.localDate
    }

    init(day: ProgressLeaderboardProfileReviewActivityDay) {
        let calendar = Calendar(identifier: .gregorian)
        guard let parsedDate = try? progressDate(localDate: day.date, calendar: calendar) else {
            preconditionFailure("Validated leaderboard profile activity date is invalid")
        }

        self.localDate = day.date
        self.date = parsedDate
        self.reviewCount = day.reviewCount
    }
}

private struct ProgressLeaderboardProfileUnavailableView: View {
    let status: ProgressLeaderboardProfileStatus

    var body: some View {
        ContentUnavailableView {
            Label(self.title, systemImage: self.systemImage)
        } description: {
            Text(self.message)
        }
        .accessibilityIdentifier(UITestIdentifier.progressLeaderboardProfileUnavailable)
    }

    private var title: String {
        switch self.status {
        case .linkedAccountRequired:
            return String(
                localized: "progress.leaderboard_profile.unavailable.linked_account_required.title",
                defaultValue: "Sign in required",
                table: progressStringsTableName,
                comment: "Leaderboard profile unavailable title when a linked account is required"
            )
        case .participationDisabled:
            return String(
                localized: "progress.leaderboard_profile.unavailable.participation_disabled.title",
                defaultValue: "Participation is off",
                table: progressStringsTableName,
                comment: "Leaderboard profile unavailable title when leaderboard participation is disabled"
            )
        case .profileUnavailable, .ready:
            return String(
                localized: "progress.leaderboard_profile.unavailable.profile_unavailable.title",
                defaultValue: "Profile unavailable",
                table: progressStringsTableName,
                comment: "Leaderboard profile unavailable title when the public profile cannot be shown"
            )
        }
    }

    private var message: String {
        switch self.status {
        case .linkedAccountRequired:
            return String(
                localized: "progress.leaderboard_profile.unavailable.linked_account_required.message",
                defaultValue: "Sign in with email to view leaderboard profiles.",
                table: progressStringsTableName,
                comment: "Leaderboard profile unavailable message when a linked account is required"
            )
        case .participationDisabled:
            return String(
                localized: "progress.leaderboard_profile.unavailable.participation_disabled.message",
                defaultValue: "Profiles are visible only while rating leaderboard participation is on.",
                table: progressStringsTableName,
                comment: "Leaderboard profile unavailable message when leaderboard participation is disabled"
            )
        case .profileUnavailable, .ready:
            return String(
                localized: "progress.leaderboard_profile.unavailable.profile_unavailable.message",
                defaultValue: "This leaderboard profile cannot be shown right now.",
                table: progressStringsTableName,
                comment: "Leaderboard profile unavailable message when the public profile cannot be shown"
            )
        }
    }

    private var systemImage: String {
        switch self.status {
        case .linkedAccountRequired:
            return "person.crop.circle.badge.plus"
        case .participationDisabled:
            return "eye.slash"
        case .profileUnavailable, .ready:
            return "person.crop.circle"
        }
    }
}

private struct ProgressLeaderboardProfileErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            ContentUnavailableView {
                Label(
                    String(
                        localized: "progress.leaderboard_profile.error.title",
                        defaultValue: "Couldn't load profile",
                        table: progressStringsTableName,
                        comment: "Leaderboard profile load failure title"
                    ),
                    systemImage: "exclamationmark.triangle"
                )
            } description: {
                Text(
                    String(
                        localized: "progress.leaderboard_profile.error.message",
                        defaultValue: "Check your connection and try again.",
                        table: progressStringsTableName,
                        comment: "Leaderboard profile load failure message"
                    )
                )
            } actions: {
                Button(
                    String(
                        localized: "progress.leaderboard_profile.retry_button",
                        defaultValue: "Try Again",
                        table: progressStringsTableName,
                        comment: "Button title for retrying a leaderboard profile load"
                    )
                ) {
                    self.onRetry()
                }
                .accessibilityIdentifier(UITestIdentifier.progressLeaderboardProfileRetryButton)
            }

            CopyableErrorMessageView(message: self.message)
                .padding(.horizontal, 20)
        }
        .accessibilityIdentifier(UITestIdentifier.progressLeaderboardProfileError)
    }
}

#Preview {
    ProgressLeaderboardProfileSheet(
        selectedProfile: ProgressLeaderboardSelectedProfile(
            publicProfileId: "preview-profile",
            anonymousDisplayName: "Cedar Peak",
            friendDisplayName: "Alex",
            isViewer: false
        )
    )
    .environment(FlashcardsStore())
}
