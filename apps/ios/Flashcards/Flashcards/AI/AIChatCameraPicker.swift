import SwiftUI
import UIKit

struct AIChatCameraPicker: UIViewControllerRepresentable {
    let onCapture: @MainActor (Data) -> Void
    let onFailure: @MainActor (Error) -> Void
    let onCancel: @MainActor () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(
            onCapture: self.onCapture,
            onFailure: self.onFailure,
            onCancel: self.onCancel
        )
    }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.delegate = context.coordinator
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.mediaTypes = ["public.image"]
        picker.allowsEditing = false
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {
    }

    final class Coordinator: NSObject, UINavigationControllerDelegate, UIImagePickerControllerDelegate {
        private let onCapture: @MainActor (Data) -> Void
        private let onFailure: @MainActor (Error) -> Void
        private let onCancel: @MainActor () -> Void

        init(
            onCapture: @escaping @MainActor (Data) -> Void,
            onFailure: @escaping @MainActor (Error) -> Void,
            onCancel: @escaping @MainActor () -> Void
        ) {
            self.onCapture = onCapture
            self.onFailure = onFailure
            self.onCancel = onCancel
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            picker.dismiss(animated: true) {
                Task { @MainActor in
                    self.onCancel()
                }
            }
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            let result = Self.makeCaptureResult(info: info)
            picker.dismiss(animated: true) {
                Task { @MainActor in
                    switch result {
                    case .success(let data):
                        self.onCapture(data)
                    case .failure(let error):
                        self.onFailure(error)
                    }
                }
            }
        }

        private static func makeCaptureResult(info: [UIImagePickerController.InfoKey: Any]) -> Result<Data, Error> {
            guard let image = info[.originalImage] as? UIImage else {
                return .failure(AIChatCameraPickerError.missingImage)
            }

            guard let data = image.jpegData(compressionQuality: aiChatCapturedPhotoCompressionQuality) else {
                return .failure(AIChatCameraPickerError.encodingFailed)
            }

            return .success(data)
        }
    }
}

private let aiChatCapturedPhotoCompressionQuality: CGFloat = 0.9

private enum AIChatCameraPickerError: LocalizedError {
    case missingImage
    case encodingFailed

    var errorDescription: String? {
        switch self {
        case .missingImage:
            return "Failed to read the captured photo."
        case .encodingFailed:
            return "Failed to prepare the captured photo."
        }
    }
}
