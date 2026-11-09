import SwiftUI

private let reviewCardsStringsTableName: String = "ReviewCards"

struct WatchRootView: View {
    let session: WatchSessionModel

    var body: some View {
        switch self.session.state {
        case .notConnected:
            WatchSessionMessageView(
                title: String(
                    localized: "watch.session.open_iphone_app",
                    table: watchStringsTableName,
                    comment: "Apple Watch message asking the user to open the iPhone app so the watch can sign in"
                ),
                message: String(
                    localized: "watch.session.not_connected.message",
                    table: watchStringsTableName,
                    comment: "Apple Watch explanation that sign-in happens in the iPhone app"
                ),
                onRetry: self.retry
            )
        case .connecting:
            ProgressView(String(
                localized: "watch.session.connecting",
                table: watchStringsTableName,
                comment: "Apple Watch progress label while the watch asks the iPhone for the account"
            ))
        case .syncing:
            ProgressView(String(
                localized: "watch.session.syncing",
                table: watchStringsTableName,
                comment: "Apple Watch progress label while cards download for the first time"
            ))
        case .ready:
            WatchReviewView(session: self.session)
        case .switchBlocked(let unsyncedRatingCount):
            WatchSwitchBlockedView(session: self.session, unsyncedRatingCount: unsyncedRatingCount)
        case .failed(let message):
            WatchSessionMessageView(title: message, message: nil, onRetry: self.retry)
        }
    }

    private func retry() {
        Task {
            await self.session.refreshFromIPhone()
        }
    }
}

private struct WatchSessionMessageView: View {
    let title: String
    let message: String?
    let onRetry: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Text(self.title)
                    .font(.headline)
                    .multilineTextAlignment(.center)
                if let message = self.message {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                Button(String(localized: "Retry", table: reviewCardsStringsTableName), action: self.onRetry)
            }
        }
    }
}

private struct WatchSwitchBlockedView: View {
    let session: WatchSessionModel
    let unsyncedRatingCount: Int
    @State private var isDiscardConfirmationPresented: Bool = false

    var body: some View {
        let discardTitle = String(
            localized: "watch.session.switch_blocked.discard",
            table: watchStringsTableName,
            comment: "Apple Watch destructive button that drops the ratings that cannot sync and follows the iPhone's account or workspace switch"
        )

        ScrollView {
            VStack(spacing: 8) {
                Text(String(
                    localized: "watch.session.switch_blocked.title \(self.unsyncedRatingCount)",
                    table: watchStringsTableName,
                    comment: "Apple Watch title with the number of ratings made on the watch that have not reached the server, while the iPhone has switched account or workspace"
                ))
                .font(.headline)
                .multilineTextAlignment(.center)
                Text(String(
                    localized: "watch.session.switch_blocked.message",
                    table: watchStringsTableName,
                    comment: "Apple Watch explanation under the unsynced ratings title: retry once online, or discard them to follow the iPhone's switch"
                ))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                if self.session.isRequestingHandoff {
                    ProgressView()
                } else {
                    Button(String(localized: "Retry", table: reviewCardsStringsTableName)) {
                        Task {
                            await self.session.refreshFromIPhone()
                        }
                    }
                    Button(discardTitle, role: .destructive) {
                        self.isDiscardConfirmationPresented = true
                    }
                }
            }
        }
        // A refresh hides the buttons, and a confirm during it would be ignored, so the dialog closes with them.
        .onChange(of: self.session.isRequestingHandoff) { _, isRequestingHandoff in
            if isRequestingHandoff {
                self.isDiscardConfirmationPresented = false
            }
        }
        .confirmationDialog(
            String(
                localized: "watch.session.switch_blocked.discard_confirmation.title \(self.unsyncedRatingCount)",
                table: watchStringsTableName,
                comment: "Apple Watch confirmation title before dropping the ratings that cannot sync"
            ),
            isPresented: self.$isDiscardConfirmationPresented,
            titleVisibility: .visible
        ) {
            Button(discardTitle, role: .destructive) {
                Task {
                    await self.session.discardUnsyncedRatingsAndSwitch()
                }
            }
        } message: {
            Text(String(
                localized: "watch.session.switch_blocked.discard_confirmation.message",
                table: watchStringsTableName,
                comment: "Apple Watch confirmation message before dropping the ratings that cannot sync"
            ))
        }
    }
}
