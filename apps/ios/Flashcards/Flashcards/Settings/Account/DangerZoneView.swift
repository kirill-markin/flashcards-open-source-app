import SwiftUI

struct DangerZoneView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    @State private var isDeleteAccountAlertPresented: Bool = false
    @State private var isDeleteAccountConfirmationPresented: Bool = false

    var body: some View {
        List {
            Section(aiSettingsLocalized("settings.account.dangerZone.section.dangerZone", "Danger Zone")) {
                Text(aiSettingsLocalized("settings.account.dangerZone.description", "Permanently delete this account and all cloud data."))
                    .foregroundStyle(.secondary)

                Button(aiSettingsLocalized("settings.account.dangerZone.deleteAccount", "Delete my account"), role: .destructive) {
                    self.isDeleteAccountAlertPresented = true
                }
                .accessibilityIdentifier(UITestIdentifier.dangerZoneDeleteAccountButton)
                .disabled(store.cloudSettings?.cloudState != .linked)
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.dangerZoneScreen)
        .navigationTitle(aiSettingsLocalized("settings.account.dangerZone.title", "Danger Zone"))
        .alert(aiSettingsLocalized("settings.account.dangerZone.alertTitle", "Delete this account?"), isPresented: self.$isDeleteAccountAlertPresented) {
            Button(aiSettingsLocalized("common.cancel", "Cancel"), role: .cancel) {}
            Button(aiSettingsLocalized("common.continue", "Continue"), role: .destructive) {
                self.isDeleteAccountConfirmationPresented = true
            }
        } message: {
            Text(aiSettingsLocalized("settings.account.dangerZone.alertMessage", "This permanently deletes the account and all cloud data."))
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
