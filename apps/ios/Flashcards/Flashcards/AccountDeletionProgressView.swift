import SwiftUI

struct AccountDeletionProgressView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    var body: some View {
        ZStack {
            Color(.systemBackground)
                .ignoresSafeArea()

            VStack(spacing: 20) {
                Text("Deleting account")
                    .font(.title2.weight(.semibold))

                switch store.accountDeletionState {
                case .hidden:
                    EmptyView()
                case .inProgress:
                    ProgressView()
                    Text("Your account deletion is in progress. Keep this screen open until it finishes.")
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                case .failed(let message):
                    Text("The delete request did not finish yet. Retry to keep the account deletion moving forward.")
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                    CopyableErrorMessageView(message: message)
                    Button("Retry deletion", role: .destructive) {
                        store.retryPendingAccountDeletion()
                    }
                }
            }
            .padding(24)
        }
        .interactiveDismissDisabled(true)
    }
}

#Preview {
    AccountDeletionProgressView()
        .environment(FlashcardsStore())
}
