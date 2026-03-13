import SwiftUI

struct WorkspaceOverviewView: View {
    @EnvironmentObject private var store: FlashcardsStore

    private var tagsCount: Int {
        workspaceTagsSummary(cards: store.cards).tags.count
    }

    var body: some View {
        List {
            if store.globalErrorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: store.globalErrorMessage)
                }
            }

            Section("Workspace") {
                LabeledContent("Workspace") {
                    Text(store.workspace?.name ?? "Unavailable")
                }

                LabeledContent("Cards") {
                    Text("\(store.homeSnapshot.totalCards)")
                }

                LabeledContent("Decks") {
                    Text("\(store.homeSnapshot.deckCount)")
                }

                LabeledContent("Tags") {
                    Text("\(self.tagsCount)")
                }
            }

            Section("Today") {
                LabeledContent("Due") {
                    Text("\(store.homeSnapshot.dueCount)")
                }

                LabeledContent("New") {
                    Text("\(store.homeSnapshot.newCount)")
                }

                LabeledContent("Reviewed") {
                    Text("\(store.homeSnapshot.reviewedCount)")
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Overview")
    }
}

#Preview {
    NavigationStack {
        WorkspaceOverviewView()
            .environmentObject(FlashcardsStore())
    }
}
