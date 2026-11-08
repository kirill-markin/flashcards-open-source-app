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
            WatchReviewPlaceholderView()
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

/// The review screen's slot.
struct WatchReviewPlaceholderView: View {
    var body: some View {
        // The product name is never localized.
        Text(verbatim: "Nibomo")
            .font(.title2)
    }
}
