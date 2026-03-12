import AVFoundation
import Photos
import SwiftUI
import UIKit

enum AccessPermissionKind: String, CaseIterable, Identifiable, Sendable {
    case photos
    case camera
    case microphone

    var id: String {
        self.rawValue
    }

    var title: String {
        switch self {
        case .photos:
            return "Photos"
        case .camera:
            return "Camera"
        case .microphone:
            return "Microphone"
        }
    }

    var systemImage: String {
        switch self {
        case .photos:
            return "photo.on.rectangle"
        case .camera:
            return "camera"
        case .microphone:
            return "mic"
        }
    }

    var description: String {
        switch self {
        case .photos:
            return "Choose photos for AI chat attachments."
        case .camera:
            return "Take photos directly from AI chat."
        case .microphone:
            return "Dictate text into AI chat."
        }
    }
}

enum AccessPermissionStatus: Sendable, Equatable {
    case allowed
    case askEveryTime
    case blocked
    case limited
    case unavailable

    var title: String {
        switch self {
        case .allowed:
            return "Allowed"
        case .askEveryTime:
            return "Ask every time"
        case .blocked:
            return "Blocked"
        case .limited:
            return "Limited"
        case .unavailable:
            return "Unavailable"
        }
    }
}

func accessPermissionStatus(kind: AccessPermissionKind) -> AccessPermissionStatus {
    switch kind {
    case .photos:
        let authorizationStatus = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        switch authorizationStatus {
        case .authorized:
            return .allowed
        case .limited:
            return .limited
        case .notDetermined:
            return .askEveryTime
        case .denied, .restricted:
            return .blocked
        @unknown default:
            return .blocked
        }
    case .camera:
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            return .unavailable
        }

        let authorizationStatus = AVCaptureDevice.authorizationStatus(for: .video)
        switch authorizationStatus {
        case .authorized:
            return .allowed
        case .notDetermined:
            return .askEveryTime
        case .denied, .restricted:
            return .blocked
        @unknown default:
            return .blocked
        }
    case .microphone:
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted:
            return .allowed
        case .undetermined:
            return .askEveryTime
        case .denied:
            return .blocked
        @unknown default:
            return .blocked
        }
    }
}

func accessPermissionPrimaryActionTitle(
    status: AccessPermissionStatus
) -> String? {
    switch status {
    case .askEveryTime:
        return "Request access"
    case .allowed, .blocked, .limited:
        return "Open Settings"
    case .unavailable:
        return nil
    }
}

func accessPermissionGuidance(kind: AccessPermissionKind, status: AccessPermissionStatus) -> String {
    switch (kind, status) {
    case (.photos, .limited):
        return "Only the photos you already shared with Flashcards are available. Open Settings to grant broader photo access."
    case (.photos, .blocked):
        return "Photo access is turned off for Flashcards. Open Settings > Privacy & Security > Photos to change it."
    case (.camera, .blocked):
        return "Camera access is turned off for Flashcards. Open Settings > Privacy & Security > Camera to change it."
    case (.microphone, .blocked):
        return "Microphone access is turned off for Flashcards. Open Settings > Privacy & Security > Microphone to change it."
    case (_, .askEveryTime):
        return "Request access now, or open Settings later if you want to manage it manually."
    case (_, .allowed):
        return "Open Settings if you want to turn this access off."
    case (_, .limited):
        return "Open Settings to review or expand this access."
    case (_, .unavailable):
        return "This access is unavailable on the current device."
    }
}

@MainActor
func requestAccessPermission(kind: AccessPermissionKind) async -> AccessPermissionStatus {
    switch kind {
    case .photos:
        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        switch status {
        case .authorized:
            return .allowed
        case .limited:
            return .limited
        case .notDetermined:
            return .askEveryTime
        case .denied, .restricted:
            return .blocked
        @unknown default:
            return .blocked
        }
    case .camera:
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            return .unavailable
        }

        let isGranted = await withCheckedContinuation { continuation in
            AVCaptureDevice.requestAccess(for: .video) { granted in
                continuation.resume(returning: granted)
            }
        }
        return isGranted ? .allowed : .blocked
    case .microphone:
        let isGranted = await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
        return isGranted ? .allowed : .blocked
    }
}

@MainActor
func openApplicationSettings() {
    guard let settingsUrl = URL(string: UIApplication.openSettingsURLString) else {
        return
    }

    if UIApplication.shared.canOpenURL(settingsUrl) {
        UIApplication.shared.open(settingsUrl)
    }
}
