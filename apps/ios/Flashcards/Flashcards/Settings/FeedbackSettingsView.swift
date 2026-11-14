import SwiftUI

struct FeedbackSettingsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel

    /// The composer this page pushed beside the side chat; the root presents every other showing as a sheet.
    private var pushedFeedbackPresentation: Binding<FeedbackPresentation?> {
        Binding(
            get: {
                self.store.feedbackPresentation.flatMap { $0.isPushed ? $0 : nil }
            },
            set: { presentation in
                if presentation == nil {
                    self.store.dismissFeedbackSheet()
                }
            }
        )
    }

    var body: some View {
        List {
            Section {
                Text(
                    aiSettingsLocalized(
                        "feedback.settings.description",
                        "Share an idea, report a rough edge, or tell us what would make Nibomo better."
                    )
                )
                    .foregroundStyle(.secondary)

                Button {
                    store.presentFeedbackSheet(trigger: .settings, isPushed: self.navigation.presentsChildScreensInHalves)
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
        .nativeNavigationTitle(aiSettingsLocalized("settings.row.sendFeedback", "Send Feedback"))
        .sectionChildPush(item: self.pushedFeedbackPresentation) { presentation in
            FeedbackSheet(presentation: presentation)
        }
    }
}

#Preview {
    NavigationStack {
        FeedbackSettingsView()
            .environment(FlashcardsStore())
            .environment(AppNavigationModel())
    }
}
