import SwiftUI

struct DangerZoneView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    @State private var isDeleteAccountAlertPresented: Bool = false
    @State private var isDeleteAccountConfirmationPresented: Bool = false

    var body: some View {
        List {
            Section("Danger Zone") {
                Text("Permanently delete this account and all cloud data.")
                    .foregroundStyle(.secondary)

                Button("Delete my account", role: .destructive) {
                    self.isDeleteAccountAlertPresented = true
                }
                .accessibilityIdentifier(UITestIdentifier.dangerZoneDeleteAccountButton)
                .disabled(store.cloudSettings?.cloudState != .linked)
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.dangerZoneScreen)
        .navigationTitle("Danger Zone")
        .alert("Delete this account?", isPresented: self.$isDeleteAccountAlertPresented) {
            Button("Cancel", role: .cancel) {}
            Button("Continue", role: .destructive) {
                self.isDeleteAccountConfirmationPresented = true
            }
        } message: {
            Text("This permanently deletes the account and all cloud data.")
        }
        .fullScreenCover(isPresented: self.$isDeleteAccountConfirmationPresented) {
            DeleteAccountConfirmationView()
                .environment(store)
        }
    }
}

#Preview {
    NavigationStack {
        DangerZoneView()
            .environment(FlashcardsStore())
    }
}
