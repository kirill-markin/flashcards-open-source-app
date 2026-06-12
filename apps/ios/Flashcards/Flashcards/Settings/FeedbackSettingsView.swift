import SwiftUI

struct FeedbackSettingsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    var body: some View {
        List {
            Section {
                Text(
                    aiSettingsLocalized(
                        "feedback.settings.description",
                        "Share an idea, report a rough edge, or tell us what would make Flashcards better."
                    )
                )
                    .foregroundStyle(.secondary)

                Button {
                    store.presentFeedbackSheet(trigger: .settings)
                } label: {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.sendFeedback", "Send Feedback"),
                        value: aiSettingsLocalized("settings.row.sendFeedback.value", "Share an idea"),
                        systemImage: "text.bubble",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.feedbackSettingsOpenFeedbackButton)
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.feedbackSettingsScreen)
        .navigationTitle(aiSettingsLocalized("settings.row.sendFeedback", "Send Feedback"))
    }
}

#Preview {
    NavigationStack {
        FeedbackSettingsView()
            .environment(FlashcardsStore())
    }
}
