import SwiftUI
import UIKit

struct WorkspacePackageExportShareItem: Hashable, Identifiable {
    let id: UUID
    let fileURL: URL
}

struct WorkspaceExportActivitySheet: UIViewControllerRepresentable {
    let activityItems: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
