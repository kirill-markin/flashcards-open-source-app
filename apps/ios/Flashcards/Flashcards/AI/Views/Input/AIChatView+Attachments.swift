import PhotosUI
import SwiftUI

extension AIChatView {
    func handleSelectedPhotoItem(_ item: PhotosPickerItem) async {
        do {
            guard self.chatStore.canAttachToDraft else {
                self.selectedPhotoItem = nil
                return
            }
            guard self.ensureExternalAIConsent() else {
                self.selectedPhotoItem = nil
                return
            }
            guard let data = try await item.loadTransferable(type: Data.self) else {
                self.chatStore.showGeneralError(message: "Failed to read the selected photo.")
                // A picked item that hands back no data is one this client cannot read, which is
                // what `unsupportedType` means here; nothing has reached the network at this point.
                Analytics.track(.mediaUploadFailed(reason: .unsupportedType), screen: .ai)
                self.selectedPhotoItem = nil
                return
            }

            let mediaType = item.supportedContentTypes.first?.preferredMIMEType ?? "image/jpeg"
            let fileExtension = item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
            let attachment = try aiChatMakeImageAttachment(
                data: data,
                fileName: "photo.\(fileExtension)",
                mediaType: mediaType
            )
            self.chatStore.appendAttachment(attachment)
            // Reported where the asset reaches the draft, never where the picker was presented.
            Analytics.track(.mediaAttached(source: .photoLibrary, screen: .ai))
        } catch {
            Analytics.track(
                .mediaUploadFailed(reason: analyticsMediaUploadFailureReason(error: error)),
                screen: .ai
            )
            self.chatStore.showGeneralError(error: error)
        }

        self.selectedPhotoItem = nil
    }

    func handleCapturedPhotoData(_ data: Data) {
        do {
            guard self.chatStore.canAttachToDraft else {
                return
            }
            guard self.ensureExternalAIConsent() else {
                return
            }
            let attachment = try aiChatMakeImageAttachment(
                data: data,
                fileName: "photo.jpg",
                mediaType: "image/jpeg"
            )
            self.chatStore.appendAttachment(attachment)
            Analytics.track(.mediaAttached(source: .camera, screen: .ai))
        } catch {
            Analytics.track(
                .mediaUploadFailed(reason: analyticsMediaUploadFailureReason(error: error)),
                screen: .ai
            )
            self.chatStore.showGeneralError(error: error)
        }
    }

    /// Reports neither half of the attachment pair: a document picked out of Files is neither
    /// `photo_library` nor `camera`, and the catalog would rather count fewer attachments than store
    /// an origin that is not true in a table that can never be repaired.
    func handleImportedFiles(_ urls: [URL]) async {
        do {
            guard self.chatStore.canAttachToDraft else {
                return
            }
            guard self.ensureExternalAIConsent() else {
                return
            }
            for url in urls {
                let attachment = try aiChatMakeAttachmentFromFile(url: url)
                self.chatStore.appendAttachment(attachment)
            }
        } catch {
            self.handleFileImportFailure(error)
        }
    }

    func handleAttachmentMenuAction(_ action: AIChatAttachmentMenuAction) {
        guard self.chatStore.canAttachToDraft else {
            return
        }
        guard self.ensureExternalAIConsent() else {
            return
        }
        self.isComposerFocused = false

        switch action {
        case .takePhoto:
            Task {
                await self.presentCameraIfAvailable()
            }
        case .choosePhoto:
            self.selectedPhotoItem = nil
            Task {
                await self.presentPhotoPickerIfAvailable()
            }
        case .chooseFile:
            self.isFileImporterPresented = true
        }
    }

    @MainActor
    func presentCameraIfAvailable() async {
        let initialStatus = accessPermissionStatus(kind: .camera)
        let requestedStatus = initialStatus == .askEveryTime
            ? await requestAccessPermission(kind: .camera)
            : nil
        let presentationResult = aiChatCameraPresentationResult(
            initialStatus: initialStatus,
            requestedStatus: requestedStatus
        )
        switch presentationResult {
        case .present:
            self.isCameraPresented = true
        case .stopSilently:
            return
        case .showAlert(let alert):
            self.chatStore.showAlert(alert)
        }
    }

    @MainActor
    func presentPhotoPickerIfAvailable() async {
        let initialStatus = accessPermissionStatus(kind: .photos)
        let requestedStatus = initialStatus == .askEveryTime
            ? await requestAccessPermission(kind: .photos)
            : nil
        let presentationResult = aiChatPhotoPresentationResult(
            initialStatus: initialStatus,
            requestedStatus: requestedStatus
        )
        switch presentationResult {
        case .present:
            self.isPhotoPickerPresented = true
        case .stopSilently:
            return
        case .showAlert(let alert):
            self.chatStore.showAlert(alert)
        }
    }

    func handleFileImportFailure(_ error: Error) {
        self.chatStore.showAlert(aiChatFileImportAlert(error: error))
    }
}
