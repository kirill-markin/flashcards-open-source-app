import SwiftUI

struct ProgressLeaderboardSection: View {
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel

    let snapshot: ProgressLeaderboardSnapshot
    /// Aggregate Progress refresh state, not just the leaderboard request: the
    /// first leaderboard fetch starts only after summary and series complete, and
    /// the offline placeholder must stay hidden while any of them is in flight.
    let isRefreshing: Bool
    let leaderboardRefreshMessage: String
    @Binding var selectedWindowKey: LeaderboardWindowKey?
    let onOpenCloudSignIn: () -> Void
    let onOpenFriendInvite: () -> Void
    let onOpenProfile: (ProgressLeaderboardSelectedProfile) -> Void

    @State private var isInfoAlertPresented: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            self.header
            self.friendInviteButton

            switch self.snapshot.state {
            case .ready(let readyState):
                self.readyContent(readyState: readyState)
            case .signInRequired:
                self.signInRequiredContent
            case .participationDisabled:
                self.participationDisabledContent
            case .snapshotUnavailable:
                self.snapshotUnavailableContent
            case .awaitingServerData:
                self.awaitingServerDataContent
            }
        }
        .padding(.vertical, 4)
        .onChange(of: self.snapshot.scopeKey) { _, _ in
            self.selectedWindowKey = nil
        }
        .alert(
            progressLeaderboardSectionTitle(),
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
            return progressLeaderboardInfoMessage(snapshotGeneratedAt: nil, now: Date())
        }

        let selectedKey = self.resolveSelectedWindowKey(readyState: readyState)
        let selectedWindow = readyState.windows.first { window in
            window.windowKey == selectedKey
        }

        return progressLeaderboardInfoMessage(
            snapshotGeneratedAt: selectedWindow?.snapshotGeneratedAt,
            now: Date()
        )
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text(progressLeaderboardSectionTitle())
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
                    localized: "progress.screen.leaderboard.info.accessibility_label",
                    defaultValue: "About the rating leaderboard",
                    table: progressStringsTableName,
                    comment: "Accessibility label for the rating leaderboard info button"
                )
            )
        }
    }

    private var friendInviteButton: some View {
        Button {
            self.onOpenFriendInvite()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "person.crop.circle.badge.plus")
                    .accessibilityHidden(true)
                Text(
                    String(
                        localized: "progress.screen.leaderboard.invite.button",
                        defaultValue: "Invite Friend",
                        table: progressStringsTableName,
                        comment: "Button title for creating a leaderboard friend invite link"
                    )
                )
            }
            .frame(maxWidth: .infinity, alignment: .center)
        }
        .buttonStyle(.borderedProminent)
        .accessibilityIdentifier(UITestIdentifier.progressLeaderboardInviteFriendButton)
        .accessibilityLabel(
            String(
                localized: "progress.screen.leaderboard.invite.accessibility_label",
                defaultValue: "Invite a friend",
                table: progressStringsTableName,
                comment: "Accessibility label for the leaderboard friend invite button"
            )
        )
    }

    @ViewBuilder
    private func readyContent(readyState: ProgressLeaderboardReadyState) -> some View {
        let selectedKey = self.resolveSelectedWindowKey(readyState: readyState)
        let selectionBinding = Binding<LeaderboardWindowKey>(
            get: {
                selectedKey
            },
            set: { nextWindowKey in
                self.selectedWindowKey = nextWindowKey
            }
        )

        Picker(
            String(
                localized: "progress.screen.leaderboard.window_picker.label",
                defaultValue: "Period",
                table: progressStringsTableName,
                comment: "Accessibility label for the leaderboard period selector"
            ),
            selection: selectionBinding
        ) {
            ForEach(LeaderboardWindowKey.stableOrder) { windowKey in
                Text(progressLeaderboardWindowTitle(key: windowKey))
                    .tag(windowKey)
            }
        }
        .pickerStyle(.segmented)

        if let selectedWindow = readyState.windows.first(where: { window in
            window.windowKey == selectedKey
        }) {
            let reservedRows = progressLeaderboardReservedRows(
                rows: selectedWindow.rows,
                windows: readyState.windows
            )

            VStack(alignment: .leading, spacing: 10) {
                ForEach(selectedWindow.rows) { row in
                    switch row {
                    case .participant(let participantRow):
                        ProgressLeaderboardParticipantRowView(
                            row: participantRow,
                            onOpenProfile: self.onOpenProfile
                        )
                    case .gap(_):
                        ProgressLeaderboardGapRowView()
                    }
                }

                ForEach(0..<reservedRows.gapRowCount, id: \.self) { _ in
                    ProgressLeaderboardReservedGapRowView()
                }

                ForEach(0..<reservedRows.participantRowCount, id: \.self) { _ in
                    ProgressLeaderboardReservedParticipantRowView()
                }
            }
        }
    }

    private func resolveSelectedWindowKey(readyState: ProgressLeaderboardReadyState) -> LeaderboardWindowKey {
        self.selectedWindowKey
            ?? resolveBestLeaderboardPlacement(readyState: readyState)?.windowKey
            ?? readyState.defaultWindowKey
    }

    private var signInRequiredContent: some View {
        ContentUnavailableView {
            Label(
                String(
                    localized: "progress.screen.leaderboard.sign_in.title",
                    defaultValue: "Join the rating leaderboard",
                    table: progressStringsTableName,
                    comment: "Progress rating leaderboard sign-in placeholder title"
                ),
                systemImage: "person.crop.circle.badge.plus"
            )
        } description: {
            Text(
                String(
                    localized: "progress.screen.leaderboard.sign_in.message",
                    defaultValue: "Sign in with email to see how your reviews rank on the rating leaderboard.",
                    table: progressStringsTableName,
                    comment: "Progress rating leaderboard sign-in placeholder message"
                )
            )
        } actions: {
            Button(
                String(
                    localized: "progress.screen.leaderboard.sign_in.button",
                    defaultValue: "Sign in or sign up",
                    table: progressStringsTableName,
                    comment: "Progress leaderboard sign-in placeholder button"
                )
            ) {
                self.onOpenCloudSignIn()
            }
            .accessibilityIdentifier(UITestIdentifier.progressLeaderboardSignInButton)
        }
    }

    private var participationDisabledContent: some View {
        ContentUnavailableView {
            Label(
                String(
                    localized: "progress.screen.leaderboard.participation_disabled.title",
                    defaultValue: "Rating participation is off",
                    table: progressStringsTableName,
                    comment: "Progress rating leaderboard participation-disabled placeholder title"
                ),
                systemImage: "eye.slash"
            )
        } description: {
            Text(
                String(
                    localized: "progress.screen.leaderboard.participation_disabled.message",
                    defaultValue: "Rankings are visible only while you participate in the rating leaderboard.",
                    table: progressStringsTableName,
                    comment: "Progress rating leaderboard participation-disabled placeholder message"
                )
            )
        } actions: {
            Button(
                String(
                    localized: "progress.screen.leaderboard.participation_disabled.button",
                    defaultValue: "Open rating leaderboard settings",
                    table: progressStringsTableName,
                    comment: "Progress rating leaderboard participation-disabled placeholder button"
                )
            ) {
                self.navigation.openSettings(destination: .leaderboardParticipation)
            }
            .accessibilityIdentifier(UITestIdentifier.progressLeaderboardOpenSettingsButton)
        }
    }

    private var snapshotUnavailableContent: some View {
        ContentUnavailableView {
            Label(
                String(
                    localized: "progress.screen.leaderboard.unavailable.title",
                    defaultValue: "Not ready yet",
                    table: progressStringsTableName,
                    comment: "Progress rating leaderboard snapshot-unavailable placeholder title"
                ),
                systemImage: "hourglass"
            )
        } description: {
            Text(
                String(
                    localized: "progress.screen.leaderboard.unavailable.message",
                    defaultValue: "The rating leaderboard is being prepared. Check back soon.",
                    table: progressStringsTableName,
                    comment: "Progress rating leaderboard snapshot-unavailable placeholder message"
                )
            )
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
        } else if self.leaderboardRefreshMessage.isEmpty == false {
            // The fetch failed for a non-connectivity reason; the offline copy
            // would be misleading. The exact error renders in the Progress error
            // banner, so this placeholder stays generic.
            ContentUnavailableView {
                Label(
                    String(
                        localized: "progress.screen.leaderboard.load_failed.title",
                        defaultValue: "Couldn't load the rating leaderboard",
                        table: progressStringsTableName,
                        comment: "Progress rating leaderboard placeholder title after a failed load"
                    ),
                    systemImage: "exclamationmark.triangle"
                )
            } description: {
                Text(
                    String(
                        localized: "progress.screen.leaderboard.load_failed.message",
                        defaultValue: "Try again later.",
                        table: progressStringsTableName,
                        comment: "Progress rating leaderboard placeholder message after a failed load"
                    )
                )
            }
        } else {
            ContentUnavailableView {
                Label(
                    String(
                        localized: "progress.screen.leaderboard.offline.title",
                        defaultValue: "You're offline",
                        table: progressStringsTableName,
                        comment: "Progress rating leaderboard offline placeholder title"
                    ),
                    systemImage: "wifi.slash"
                )
            } description: {
                Text(
                    String(
                        localized: "progress.screen.leaderboard.offline.message",
                        defaultValue: "Connect to the internet to load the rating leaderboard.",
                        table: progressStringsTableName,
                        comment: "Progress rating leaderboard offline placeholder message"
                    )
                )
            }
        }
    }
}

private struct ProgressLeaderboardReservedRows: Hashable {
    let participantRowCount: Int
    let gapRowCount: Int
}

private func progressLeaderboardReservedRows(
    rows: [ProgressLeaderboardRowState],
    windows: [ProgressLeaderboardWindowState]
) -> ProgressLeaderboardReservedRows {
    let reservedRowCount = max(0, progressLeaderboardMaximumRowCount(windows: windows) - rows.count)
    let missingGapRowCount = max(
        0,
        progressLeaderboardMaximumGapRowCount(windows: windows) - progressLeaderboardGapRowCount(rows: rows)
    )
    let gapRowCount = min(missingGapRowCount, reservedRowCount)

    return ProgressLeaderboardReservedRows(
        participantRowCount: reservedRowCount - gapRowCount,
        gapRowCount: gapRowCount
    )
}

private func progressLeaderboardMaximumRowCount(
    windows: [ProgressLeaderboardWindowState]
) -> Int {
    windows.map { window in
        window.rows.count
    }
    .max() ?? 0
}

private func progressLeaderboardMaximumGapRowCount(
    windows: [ProgressLeaderboardWindowState]
) -> Int {
    windows.map { window in
        progressLeaderboardGapRowCount(rows: window.rows)
    }
    .max() ?? 0
}

private func progressLeaderboardGapRowCount(
    rows: [ProgressLeaderboardRowState]
) -> Int {
    rows.reduce(0) { count, row in
        if case .gap(_) = row {
            return count + 1
        }
        return count
    }
}

private struct ProgressLeaderboardParticipantRowView: View {
    let row: ProgressLeaderboardParticipantRowState
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
        Button {
            self.onOpenProfile(self.selectedProfile)
        } label: {
            self.content
        }
        .buttonStyle(.plain)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier(self.accessibilityIdentifier)
        .accessibilityLabel(self.displayName)
        .accessibilityValue(self.accessibilityValue)
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

            Text(self.row.qualifiedReviewCount.formatted())
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

    private var selectedProfile: ProgressLeaderboardSelectedProfile {
        ProgressLeaderboardSelectedProfile(
            publicProfileId: self.row.publicProfileId,
            anonymousDisplayName: self.row.anonymousDisplayName,
            friendDisplayName: self.row.friendDisplayName,
            isViewer: self.row.kind == .viewer
        )
    }

    private var accessibilityIdentifier: String {
        "\(UITestIdentifier.progressLeaderboardRowPrefix)\(self.row.rank).\(self.row.publicProfileId)"
    }

    private var accessibilityValue: String {
        let localizedFormat = String(
            localized: "progress.screen.leaderboard.row.accessibility_value",
            defaultValue: "Rank %1$lld, %2$lld reviews",
            table: progressStringsTableName,
            comment: "Accessibility value for a leaderboard row with rank and qualified review count"
        )
        return String(
            format: localizedFormat,
            locale: Locale.current,
            Int64(self.row.rank),
            Int64(self.row.qualifiedReviewCount)
        )
    }
}

private struct ProgressLeaderboardReservedParticipantRowView: View {
    var body: some View {
        HStack(spacing: 10) {
            Text("0")
                .font(.subheadline.monospacedDigit())
                .frame(minWidth: 28, alignment: .leading)

            Text("Reserved leaderboard row")
                .font(.subheadline)
                .lineLimit(1)

            Spacer(minLength: 12)

            Text("0")
                .font(.subheadline.monospacedDigit())
        }
        .hidden()
        .accessibilityHidden(true)
    }
}

private struct ProgressLeaderboardReservedGapRowView: View {
    var body: some View {
        ProgressLeaderboardGapRowView()
            .hidden()
            .accessibilityHidden(true)
    }
}

private struct ProgressLeaderboardGapRowView: View {
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
