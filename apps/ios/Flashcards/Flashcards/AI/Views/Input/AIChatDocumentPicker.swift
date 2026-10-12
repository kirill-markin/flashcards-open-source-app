#if targetEnvironment(macCatalyst)
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct AIChatDocumentPicker: UIViewControllerRepresentable {
    let contentTypes: [UTType]
    let onSelection: @MainActor ([URL]) -> Void
    let onCancel: @MainActor () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onSelection: self.onSelection, onCancel: self.onCancel)
    }

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(
            forOpeningContentTypes: self.contentTypes,
            asCopy: true
        )
        picker.delegate = context.coordinator
        picker.allowsMultipleSelection = true
        return picker
    }

    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {
    }

    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        private let onSelection: @MainActor ([URL]) -> Void
        private let onCancel: @MainActor () -> Void

        init(
            onSelection: @escaping @MainActor ([URL]) -> Void,
            onCancel: @escaping @MainActor () -> Void
        ) {
            self.onSelection = onSelection
            self.onCancel = onCancel
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            controller.dismiss(animated: true) {
                Task { @MainActor in
                    self.onSelection(urls)
                }
            }
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            controller.dismiss(animated: true) {
                Task { @MainActor in
                    self.onCancel()
                }
            }
        }
    }
}
#endif
