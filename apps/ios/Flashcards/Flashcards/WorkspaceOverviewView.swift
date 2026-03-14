import SwiftUI

struct WorkspaceOverviewView: View {
    @EnvironmentObject private var store: FlashcardsStore
    @State private var overviewSnapshot: WorkspaceOverviewSnapshot? = nil
    @State private var errorMessage: String = ""
    @State private var isLoading: Bool = true

    var body: some View {
        List {
            if self.errorMessage.isEmpty == false || store.globalErrorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: self.errorMessage.isEmpty ? store.globalErrorMessage : self.errorMessage)
                }
            }

            Section("Workspace") {
                LabeledContent("Workspace") {
                    Text(self.overviewSnapshot?.workspaceName ?? store.workspace?.name ?? "Unavailable")
                }

                LabeledContent("Cards") {
                    Text("\(self.overviewSnapshot?.totalCards ?? 0)")
                }

                LabeledContent("Decks") {
                    Text("\(self.overviewSnapshot?.deckCount ?? 0)")
                }

                LabeledContent("Tags") {
                    Text("\(self.overviewSnapshot?.tagsCount ?? 0)")
                }
            }

            Section("Today") {
                LabeledContent("Due") {
                    Text("\(self.overviewSnapshot?.dueCount ?? 0)")
                }

                LabeledContent("New") {
                    Text("\(self.overviewSnapshot?.newCount ?? 0)")
                }

                LabeledContent("Reviewed") {
                    Text("\(self.overviewSnapshot?.reviewedCount ?? 0)")
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Overview")
        .task(id: store.localReadVersion) {
            await self.reloadWorkspaceOverview()
        }
    }

    @MainActor
    private func reloadWorkspaceOverview() async {
        guard let database = store.database, let workspace = store.workspace else {
            self.overviewSnapshot = nil
            self.errorMessage = ""
            self.isLoading = false
            return
        }

        self.isLoading = true
        self.errorMessage = ""

        do {
            self.overviewSnapshot = try database.loadWorkspaceOverviewSnapshot(
                workspaceId: workspace.workspaceId,
                workspaceName: workspace.name,
                now: Date()
            )
        } catch {
            self.errorMessage = localizedMessage(error: error)
        }

        self.isLoading = false
    }
}

#Preview {
    NavigationStack {
        WorkspaceOverviewView()
            .environmentObject(FlashcardsStore())
    }
}
