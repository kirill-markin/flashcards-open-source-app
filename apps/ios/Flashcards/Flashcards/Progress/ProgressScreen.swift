import Foundation
import SwiftUI

enum ProgressScreenSectionID: Hashable {
    case streak
    case leaderboard
    case streakLeaderboard
}

private struct ProgressPresentationTaskID: Hashable {
    let requestID: UUID?
    let hasStreakSection: Bool
    let hasLeaderboardSection: Bool
    let hasStreakLeaderboardSection: Bool
}

struct ProgressScreen: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel
    @State private var selectedLeaderboardWindowKey: LeaderboardWindowKey?
    @State private var selectedLeaderboardProfile: ProgressLeaderboardSelectedProfile?
    @State private var isCloudSignInPresented: Bool = false
    @State private var isFriendInvitePresented: Bool = false

    private var isLeaderboardSectionAvailable: Bool {
        self.store.progressSnapshot != nil && self.store.progressLeaderboardSnapshot != nil
    }

    private var isStreakSectionAvailable: Bool {
        self.store.progressSnapshot != nil
    }

    private var isStreakLeaderboardSectionAvailable: Bool {
        self.store.progressSnapshot != nil && self.store.progressStreakLeaderboardSnapshot != nil
    }

    private var progressPresentationTaskID: ProgressPresentationTaskID {
        ProgressPresentationTaskID(
            requestID: self.navigation.progressPresentationRequest?.id,
            hasStreakSection: self.isStreakSectionAvailable,
            hasLeaderboardSection: self.isLeaderboardSectionAvailable,
            hasStreakLeaderboardSection: self.isStreakLeaderboardSectionAvailable
        )
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
                    ProgressErrorBanner(message: self.store.progressErrorMessage)

                    if let progressSnapshot = self.store.progressSnapshot {
                        ProgressLoadedSections(
                            progressSnapshot: progressSnapshot,
                            leaderboardSnapshot: self.store.progressLeaderboardSnapshot,
                            streakLeaderboardSnapshot: self.store.progressStreakLeaderboardSnapshot,
                            reviewScheduleSnapshot: self.store.reviewScheduleSnapshot,
                            isProgressRefreshing: self.store.isProgressRefreshing,
                            leaderboardRefreshMessage: self.store.progressErrorState.leaderboardRefreshMessage,
                            streakLeaderboardRefreshMessage: self.store.progressErrorState.streakLeaderboardRefreshMessage,
                            selectedLeaderboardWindowKey: self.$selectedLeaderboardWindowKey,
                            onOpenCloudSignIn: self.openCloudSignInFlow,
                            onOpenFriendInvite: self.openFriendInviteFlow,
                            onOpenProfile: self.openLeaderboardProfile
                        )
                    } else if self.store.isProgressRefreshing == false {
                        ProgressUnavailableCard()
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
                    table: "Foundation",
                    comment: "Progress screen title"
                )
            )
            .refreshable {
                await self.store.refreshProgressManually()
            }
            .task(id: self.progressPresentationTaskID) {
                await self.handleProgressPresentationRequest(proxy: proxy)
            }
        }
        .sheet(isPresented: self.$isCloudSignInPresented) {
            CloudSignInSheet(presentationContext: .standard)
                .environment(self.store)
        }
        .sheet(isPresented: self.$isFriendInvitePresented) {
            ProgressFriendInviteSheet()
                .environment(self.store)
        }
        .sheet(item: self.$selectedLeaderboardProfile) { selectedProfile in
            ProgressLeaderboardProfileSheet(selectedProfile: selectedProfile)
                .environment(self.store)
        }
    }

    private func openCloudSignInFlow() {
        self.isCloudSignInPresented = true
    }

    private func openFriendInviteFlow() {
        guard self.store.cloudSettings?.cloudState == .linked else {
            self.isCloudSignInPresented = true
            return
        }

        self.isFriendInvitePresented = true
    }

    private func openLeaderboardProfile(_ selectedProfile: ProgressLeaderboardSelectedProfile) {
        self.selectedLeaderboardProfile = selectedProfile
    }

    @MainActor
    private func handleProgressPresentationRequest(proxy: ScrollViewProxy) async {
        guard let request = self.navigation.progressPresentationRequest else {
            return
        }
        if request.target == .leaderboard {
            self.selectedLeaderboardWindowKey = nil
        }

        guard self.isProgressPresentationTargetAvailable(target: request.target) else {
            return
        }
        await Task.yield()
        guard self.navigation.progressPresentationRequest?.id == request.id else {
            return
        }
        guard self.isProgressPresentationTargetAvailable(target: request.target) else {
            return
        }

        withAnimation {
            proxy.scrollTo(self.progressScreenSectionID(target: request.target), anchor: .top)
        }
        self.navigation.clearProgressPresentationRequest(id: request.id)
    }

    private func isProgressPresentationTargetAvailable(target: ProgressPresentationTarget) -> Bool {
        switch target {
        case .streak:
            return self.isStreakSectionAvailable
        case .leaderboard:
            return self.isLeaderboardSectionAvailable
        }
    }

    private func progressScreenSectionID(target: ProgressPresentationTarget) -> ProgressScreenSectionID {
        switch target {
        case .streak:
            return .streak
        case .leaderboard:
            return .leaderboard
        }
    }
}

#Preview {
    NavigationStack {
        ProgressScreen()
            .environment(FlashcardsStore())
            .environment(AppNavigationModel())
    }
}
