import SwiftUI

struct ProgressStreakLeaderboardSection: View {
    let snapshot: ProgressStreakLeaderboardSnapshot
    /// Aggregate Progress refresh state, not just the streak leaderboard request:
    /// the local viewer row depends on the current Progress summary.
    let isRefreshing: Bool
    let streakLeaderboardRefreshMessage: String
    let onOpenProfile: (ProgressLeaderboardSelectedProfile) -> Void

    @State private var isInfoAlertPresented: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            self.header

            switch self.snapshot.state {
            case .ready(let readyState):
                self.readyContent(readyState: readyState)
            case .awaitingServerData:
                self.awaitingServerDataContent
            }
        }
        .padding(.vertical, 4)
        .alert(
            progressStreakLeaderboardSectionTitle(),
            isPresented: self.$isInfoAlertPresented
        ) {
            Button(
                String(
                    localized: "shared.ok",
                    table: progressStringsTableName,
                    comment: "Confirmation button title"
                ),
                role: .cancel
            ) {}
        } message: {
            Text(self.infoMessage)
        }
    }

    private var infoMessage: String {
        guard case .ready(let readyState) = self.snapshot.state else {
            return progressStreakLeaderboardInfoMessage(snapshotGeneratedAt: nil, now: Date())
        }

        return progressStreakLeaderboardInfoMessage(
            snapshotGeneratedAt: readyState.snapshotGeneratedAt,
            now: Date()
        )
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text(progressStreakLeaderboardSectionTitle())
                .font(.headline)

            Spacer(minLength: 12)

            Button {
                self.isInfoAlertPresented = true
            } label: {
                Image(systemName: "info.circle")
                    .font(.body)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(
                String(
                    localized: "progress.screen.streak_leaderboard.info.accessibility_label",
                    defaultValue: "About the streak leaderboard",
                    table: progressStringsTableName,
                    comment: "Accessibility label for the streak leaderboard info button"
                )
            )
        }
    }

    private func readyContent(readyState: ProgressStreakLeaderboardReadyState) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(readyState.rows) { row in
                switch row {
                case .participant(let participantRow):
                    ProgressStreakLeaderboardParticipantRowView(
                        row: participantRow,
                        onOpenProfile: self.onOpenProfile
                    )
                case .gap(_):
                    ProgressStreakLeaderboardGapRowView()
                }
            }
        }
    }

    @ViewBuilder
    private var awaitingServerDataContent: some View {
        if self.isRefreshing {
            HStack {
                Spacer(minLength: 0)
                ProgressView()
                Spacer(minLength: 0)
            }
            .padding(.vertical, 24)
        } else if self.streakLeaderboardRefreshMessage.isEmpty == false {
            ContentUnavailableView {
                Label(
                    String(
                        localized: "progress.screen.streak_leaderboard.load_failed.title",
                        defaultValue: "Couldn't load the streak leaderboard",
                        table: progressStringsTableName,
                        comment: "Progress streak leaderboard placeholder title after a failed load"
                    ),
                    systemImage: "exclamationmark.triangle"
                )
            } description: {
                Text(
                    String(
                        localized: "progress.screen.streak_leaderboard.load_failed.message",
                        defaultValue: "Try again later.",
                        table: progressStringsTableName,
                        comment: "Progress streak leaderboard placeholder message after a failed load"
                    )
                )
            }
        } else {
            ContentUnavailableView {
                Label(
                    String(
                        localized: "progress.screen.streak_leaderboard.offline.title",
                        defaultValue: "You're offline",
                        table: progressStringsTableName,
                        comment: "Progress streak leaderboard offline placeholder title"
                    ),
                    systemImage: "wifi.slash"
                )
            } description: {
                Text(
                    String(
                        localized: "progress.screen.streak_leaderboard.offline.message",
                        defaultValue: "Connect to the internet to load the streak leaderboard.",
                        table: progressStringsTableName,
                        comment: "Progress streak leaderboard offline placeholder message"
                    )
                )
            }
        }
    }
}

private struct ProgressStreakLeaderboardParticipantRowView: View {
    let row: ProgressStreakLeaderboardParticipantRowState
    let onOpenProfile: (ProgressLeaderboardSelectedProfile) -> Void

    private var isViewer: Bool {
        self.row.kind == .viewer
    }

    private var displayName: String {
        if self.isViewer {
            return progressLeaderboardViewerRowTitle()
        }

        return self.row.friendDisplayName ?? self.row.anonymousDisplayName
    }

    var body: some View {
        if let selectedProfile {
            Button {
                self.onOpenProfile(selectedProfile)
            } label: {
                self.content
            }
            .buttonStyle(.plain)
            .contentShape(Rectangle())
            .accessibilityElement(children: .ignore)
            .accessibilityIdentifier(self.accessibilityIdentifier)
            .accessibilityLabel(self.displayName)
            .accessibilityValue(self.accessibilityValue)
        } else {
            self.content
                .accessibilityElement(children: .ignore)
                .accessibilityIdentifier(self.accessibilityIdentifier)
                .accessibilityLabel(self.displayName)
                .accessibilityValue(self.accessibilityValue)
        }
    }

    private var content: some View {
        HStack(spacing: 10) {
            Text(self.row.rank.formatted())
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(minWidth: 28, alignment: .leading)

            Text(self.displayName)
                .font(.subheadline)
                .fontWeight(self.isViewer ? .semibold : .regular)
                .foregroundStyle(.primary)
                .lineLimit(1)

            Spacer(minLength: 12)

            Text(progressStreakLeaderboardDayCountText(streakDays: self.row.streakDays))
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(self.isViewer ? .primary : .secondary)
        }
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(self.isViewer ? Color.accentColor.opacity(0.12) : Color.clear)
                .padding(.horizontal, -8)
                .padding(.vertical, -4)
        )
    }

    private var selectedProfile: ProgressLeaderboardSelectedProfile? {
        guard let publicProfileId = self.row.publicProfileId else {
            return nil
        }

        return ProgressLeaderboardSelectedProfile(
            publicProfileId: publicProfileId,
            anonymousDisplayName: self.row.anonymousDisplayName,
            friendDisplayName: self.row.friendDisplayName,
            isViewer: self.row.kind == .viewer
        )
    }

    private var accessibilityIdentifier: String {
        let profileIdentifier = self.row.publicProfileId ?? "local-viewer"
        return "\(UITestIdentifier.progressStreakLeaderboardRowPrefix)\(self.row.rank).\(profileIdentifier)"
    }

    private var accessibilityValue: String {
        let localizedFormat = String(
            localized: "progress.screen.streak_leaderboard.row.accessibility_value",
            defaultValue: "Rank %1$lld, %2$@",
            table: progressStringsTableName,
            comment: "Accessibility value for a streak leaderboard row with rank and streak day count"
        )
        return String(
            format: localizedFormat,
            locale: Locale.current,
            Int64(self.row.rank),
            progressStreakLeaderboardDayCountText(streakDays: self.row.streakDays)
        )
    }
}

private struct ProgressStreakLeaderboardGapRowView: View {
    var body: some View {
        HStack {
            Spacer(minLength: 0)

            Image(systemName: "ellipsis")
                .font(.subheadline)
                .foregroundStyle(.tertiary)

            Spacer(minLength: 0)
        }
        .accessibilityHidden(true)
    }
}
