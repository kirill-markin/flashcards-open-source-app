import Foundation
import UIKit
import UniformTypeIdentifiers

private let aiChatCanonicalFileMediaTypesByExtension: [String: String] = [
    "csv": "text/csv",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "html": "text/html",
    "js": "text/javascript",
    "json": "application/json",
    "log": "text/plain",
    "md": "text/markdown",
    "pdf": "application/pdf",
    "py": "text/x-python",
    "sql": "text/plain",
    "ts": "application/typescript",
    "txt": "text/plain",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "xml": "text/xml",
    "yaml": "application/x-yaml",
    "yml": "application/x-yaml"
]

enum AIChatAttachmentMenuAction: String, CaseIterable, Identifiable {
    case takePhoto
    case choosePhoto
    case chooseFile

    var id: String {
        self.rawValue
    }

    var title: String {
        localizedAIAttachmentMenuActionTitle(self)
    }

    var systemImage: String {
        switch self {
        case .takePhoto:
            return "camera"
        case .choosePhoto:
            return "photo"
        case .chooseFile:
            return "doc"
        }
    }
}

func aiChatAttachmentMenuActions() -> [AIChatAttachmentMenuAction] {
    [
        .takePhoto,
        .choosePhoto,
        .chooseFile,
    ]
}

func aiChatImporterContentTypes() -> [UTType] {
    let baseTypes = aiChatSupportedFileExtensions.compactMap { fileExtension in
        UTType(filenameExtension: fileExtension)
    }

    return baseTypes.sorted { left, right in
        left.identifier < right.identifier
    }
}

func aiChatMakeAttachmentFromFile(url: URL) throws -> AIChatAttachment {
    let fileExtension = url.pathExtension.lowercased()
    guard aiChatSupportedFileExtensions.contains(fileExtension) else {
        throw NSError(
            domain: "AIChatAttachment",
            code: 1,
            userInfo: [
                NSLocalizedDescriptionKey: aiSettingsLocalizedFormat(
                    "ai.attachment.error.unsupportedType",
                    "Unsupported file type: .%@",
                    fileExtension
                )
            ]
        )
    }

    let didAccess = url.startAccessingSecurityScopedResource()
    defer {
        if didAccess {
            url.stopAccessingSecurityScopedResource()
        }
    }

    let data = try Data(contentsOf: url)
    try aiChatValidateAttachmentSize(data: data)
    let mediaType = try aiChatCanonicalFileAttachmentMediaType(fileExtension: fileExtension)

    return AIChatAttachment(
        id: UUID().uuidString.lowercased(),
        payload: .binary(
            fileName: url.lastPathComponent,
            mediaType: mediaType,
            base64Data: data.base64EncodedString()
        )
    )
}

private func aiChatCanonicalFileAttachmentMediaType(fileExtension: String) throws -> String {
    let normalizedExtension = fileExtension.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard let mediaType = aiChatCanonicalFileMediaTypesByExtension[normalizedExtension] else {
        throw NSError(
            domain: "AIChatAttachment",
            code: 1,
            userInfo: [
                NSLocalizedDescriptionKey: aiSettingsLocalizedFormat(
                    "ai.attachment.error.unsupportedType",
                    "Unsupported file type: .%@",
                    normalizedExtension
                )
            ]
        )
    }

    return mediaType
}

func aiChatMakeImageAttachment(data: Data, fileName: String, mediaType: String) throws -> AIChatAttachment {
    let preparedImage = try aiChatPrepareImageAttachmentData(
        data: data,
        fileName: fileName,
        mediaType: mediaType
    )
    try aiChatValidateAttachmentSize(data: preparedImage.data)

    return AIChatAttachment(
        id: UUID().uuidString.lowercased(),
        payload: .binary(
            fileName: preparedImage.fileName,
            mediaType: preparedImage.mediaType,
            base64Data: preparedImage.data.base64EncodedString()
        )
    )
}

enum AIChatAttachmentPresentationResult: Equatable {
    case present
    case stopSilently
    case showAlert(AIChatAlert)
}

func aiChatCameraPresentationResult(
    initialStatus: AccessPermissionStatus,
    requestedStatus: AccessPermissionStatus?
) -> AIChatAttachmentPresentationResult {
    switch initialStatus {
    case .allowed:
        return .present
    case .askEveryTime:
        guard let requestedStatus else {
            return .stopSilently
        }

        switch requestedStatus {
        case .allowed:
            return .present
        case .blocked, .askEveryTime:
            return .stopSilently
        case .limited, .unavailable:
            return .showAlert(
                .generalError(
                    title: aiSettingsLocalized("ai.error.title", "Error"),
                    message: aiSettingsLocalized(
                        "ai.attachment.error.cameraUnavailable",
                        "Camera is not available on this device."
                    )
                )
            )
        }
    case .blocked, .limited:
        return .showAlert(.attachmentSettings(source: .camera))
    case .unavailable:
        return .showAlert(
            .generalError(
                title: aiSettingsLocalized("ai.error.title", "Error"),
                message: aiSettingsLocalized(
                    "ai.attachment.error.cameraUnavailable",
                    "Camera is not available on this device."
                )
            )
        )
    }
}

func aiChatPhotoPresentationResult(
    initialStatus: AccessPermissionStatus,
    requestedStatus: AccessPermissionStatus?
) -> AIChatAttachmentPresentationResult {
    switch initialStatus {
    case .allowed, .limited:
        return .present
    case .askEveryTime:
        guard let requestedStatus else {
            return .stopSilently
        }

        switch requestedStatus {
        case .allowed, .limited:
            return .present
        case .blocked, .askEveryTime:
            return .stopSilently
        case .unavailable:
            return .showAlert(
                .generalError(
                    title: aiSettingsLocalized("ai.error.title", "Error"),
                    message: aiSettingsLocalized(
                        "ai.attachment.error.photoUnavailable",
                        "Photo access is not available on this device."
                    )
                )
            )
        }
    case .blocked:
        return .showAlert(.attachmentSettings(source: .photos))
    case .unavailable:
        return .showAlert(
            .generalError(
                title: aiSettingsLocalized("ai.error.title", "Error"),
                message: aiSettingsLocalized(
                    "ai.attachment.error.photoUnavailable",
                    "Photo access is not available on this device."
                )
            )
        )
    }
}

func aiChatFileImportAlert(error: Error) -> AIChatAlert {
    if aiChatIsFilePermissionError(error: error) {
        return .attachmentSettings(source: .files)
    }

    return aiChatGeneralErrorAlert(error: error, resumeAttemptSequence: nil)
}

func aiChatIsFilePermissionError(error: Error) -> Bool {
    let nsError = error as NSError
    if nsError.domain == NSCocoaErrorDomain {
        let noPermissionCodes = [
            CocoaError.Code.fileReadNoPermission.rawValue,
            CocoaError.Code.fileWriteNoPermission.rawValue,
        ]
        return noPermissionCodes.contains(nsError.code)
    }

    if nsError.domain == NSPOSIXErrorDomain {
        let noPermissionCodes = [
            Int(EACCES),
            Int(EPERM),
        ]
        return noPermissionCodes.contains(nsError.code)
    }

    return false
}

private func aiChatValidateAttachmentSize(data: Data) throws {
    if data.count > aiChatMaximumAttachmentBytes {
        throw NSError(
            domain: "AIChatAttachment",
            code: 2,
            userInfo: [
                NSLocalizedDescriptionKey: aiSettingsLocalized(
                    "ai.attachment.error.fileTooLarge",
                    "File is too large. Maximum allowed size is 3 MB."
                ),
            ]
        )
    }
}

private struct AIChatPreparedImageAttachment {
    let data: Data
    let fileName: String
    let mediaType: String
}

private struct AIChatImageCompressionPolicy {
    let maximumSidePixels: CGFloat
    let quality: CGFloat
}

private let aiChatDefaultImageCompressionPolicy = AIChatImageCompressionPolicy(
    maximumSidePixels: 2_048,
    quality: 0.8
)
private let aiChatFallbackImageCompressionPolicy = AIChatImageCompressionPolicy(
    maximumSidePixels: 1_280,
    quality: 0.55
)

private func aiChatPrepareImageAttachmentData(
    data: Data,
    fileName: String,
    mediaType: String
) throws -> AIChatPreparedImageAttachment {
    guard let image = UIImage(data: data) else {
        try aiChatValidateAttachmentSize(data: data)
        return AIChatPreparedImageAttachment(
            data: data,
            fileName: fileName,
            mediaType: mediaType
        )
    }

    let compressedData = try aiChatCompressImage(
        image: image,
        policy: aiChatDefaultImageCompressionPolicy
    )
    if compressedData.count <= aiChatMaximumAttachmentBytes {
        return AIChatPreparedImageAttachment(
            data: compressedData,
            fileName: aiChatJpegFileName(fileName),
            mediaType: "image/jpeg"
        )
    }

    let fallbackData = try aiChatCompressImage(
        image: image,
        policy: aiChatFallbackImageCompressionPolicy
    )
    return AIChatPreparedImageAttachment(
        data: fallbackData,
        fileName: aiChatJpegFileName(fileName),
        mediaType: "image/jpeg"
    )
}

private func aiChatCompressImage(
    image: UIImage,
    policy: AIChatImageCompressionPolicy
) throws -> Data {
    let scaledSize = try aiChatScaledImageSize(
        imageSize: image.size,
        maximumSidePixels: policy.maximumSidePixels
    )
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    format.opaque = true
    let renderer = UIGraphicsImageRenderer(size: scaledSize, format: format)
    let renderedImage = renderer.image { _ in
        UIColor.white.setFill()
        UIRectFill(CGRect(origin: .zero, size: scaledSize))
        image.draw(in: CGRect(origin: .zero, size: scaledSize))
    }

    guard let compressedData = renderedImage.jpegData(compressionQuality: policy.quality) else {
        throw NSError(
            domain: "AIChatAttachment",
            code: 3,
            userInfo: [
                NSLocalizedDescriptionKey: aiSettingsLocalized(
                    "ai.attachment.error.imageEncodeFailed",
                    "Failed to prepare the selected photo."
                ),
            ]
        )
    }

    return compressedData
}

private func aiChatScaledImageSize(
    imageSize: CGSize,
    maximumSidePixels: CGFloat
) throws -> CGSize {
    guard imageSize.width > 0, imageSize.height > 0 else {
        throw NSError(
            domain: "AIChatAttachment",
            code: 4,
            userInfo: [
                NSLocalizedDescriptionKey: aiSettingsLocalized(
                    "ai.attachment.error.imageDimensionsInvalid",
                    "Failed to read the selected photo."
                ),
            ]
        )
    }

    let longestSide = max(imageSize.width, imageSize.height)
    if longestSide <= maximumSidePixels {
        return CGSize(
            width: max(1, imageSize.width.rounded()),
            height: max(1, imageSize.height.rounded())
        )
    }

    let scale = maximumSidePixels / longestSide
    return CGSize(
        width: max(1, (imageSize.width * scale).rounded()),
        height: max(1, (imageSize.height * scale).rounded())
    )
}

private func aiChatJpegFileName(_ fileName: String) -> String {
    let baseName = URL(fileURLWithPath: fileName)
        .deletingPathExtension()
        .lastPathComponent
        .trimmingCharacters(in: .whitespacesAndNewlines)
    let resolvedBaseName = baseName.isEmpty ? "photo" : baseName
    return "\(resolvedBaseName).jpg"
}
