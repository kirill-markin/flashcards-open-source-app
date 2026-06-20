import SwiftUI
import UIKit

struct TechnicalErrorSheet: View {
    let presentation: TechnicalErrorPresentation
    let onClose: () -> Void

    @State private var isTechnicalDetailsExpanded: Bool = false

    private var technicalDetailsTitle: String {
        String(
            localized: "technical_error.sheet.details_title",
            defaultValue: "Technical details",
            table: "Foundation",
            comment: "Technical error sheet disclosure title"
        )
    }

    private var copyDetailsTitle: String {
        String(
            localized: "technical_error.sheet.copy_details",
            defaultValue: "Copy details",
            table: "Foundation",
            comment: "Technical error sheet copy details button title"
        )
    }

    private var closeTitle: String {
        String(
            localized: "technical_error.sheet.close",
            defaultValue: "Close",
            table: "Foundation",
            comment: "Technical error sheet close button title"
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(self.presentation.message)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier(UITestIdentifier.technicalErrorMessage)
                }

                Section {
                    DisclosureGroup(isExpanded: self.$isTechnicalDetailsExpanded) {
                        Text(self.presentation.technicalDetails)
                            .font(.footnote.monospaced())
                            .textSelection(.enabled)
                            .accessibilityIdentifier(UITestIdentifier.technicalErrorDetailsText)
                            .contextMenu {
                                Button(self.copyDetailsTitle) {
                                    self.copyTechnicalDetails()
                                }
                            }

                        Button {
                            self.copyTechnicalDetails()
                        } label: {
                            Label(self.copyDetailsTitle, systemImage: "doc.on.doc")
                        }
                        .accessibilityIdentifier(UITestIdentifier.technicalErrorCopyDetailsButton)
                    } label: {
                        Text(self.technicalDetailsTitle)
                    }
                    .accessibilityIdentifier(UITestIdentifier.technicalErrorDetailsDisclosure)
                }
            }
            .navigationTitle(self.presentation.title)
            .navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier(UITestIdentifier.technicalErrorSheet)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(self.closeTitle, action: self.onClose)
                        .accessibilityIdentifier(UITestIdentifier.technicalErrorCloseButton)
                }
            }
        }
    }

    private func copyTechnicalDetails() {
        UIPasteboard.general.string = self.presentation.technicalDetails
    }
}

extension View {
    @MainActor
    func technicalErrorSheet(store: FlashcardsStore) -> some View {
        self.sheet(item: technicalErrorPresentation(store: store)) { presentation in
            TechnicalErrorSheet(
                presentation: presentation,
                onClose: {
                    store.dismissTechnicalError()
                }
            )
        }
    }

    @MainActor
    func technicalErrorSheetHost(store: FlashcardsStore) -> some View {
        self.technicalErrorSheet(store: store)
    }
}

@MainActor
private func technicalErrorPresentation(store: FlashcardsStore) -> Binding<TechnicalErrorPresentation?> {
    Binding<TechnicalErrorPresentation?>(
        get: {
            store.presentedTechnicalError
        },
        set: { presentation in
            if presentation == nil {
                store.dismissTechnicalError()
            }
        }
    )
}

#Preview {
    TechnicalErrorSheet(
        presentation: makeTechnicalErrorPreviewPresentation(),
        onClose: {}
    )
}
