import AVFoundation
import Photos
import SwiftUI
import UIKit

enum AccessPermissionKind: String, CaseIterable, Identifiable, Hashable, Sendable {
    case photos
    case camera
    case microphone

    var id: String {
        self.rawValue
    }

    var title: String {
        switch self {
        case .photos:
            return String(
                localized: "access_permission.photos.title",
                table: "Foundation",
                comment: "Photos permission title"
            )
        case .camera:
            return String(
                localized: "access_permission.camera.title",
                table: "Foundation",
                comment: "Camera permission title"
            )
        case .microphone:
            return String(
                localized: "access_permission.microphone.title",
                table: "Foundation",
                comment: "Microphone permission title"
            )
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
            return String(
                localized: "access_permission.photos.description",
                table: "Foundation",
                comment: "Photos permission description"
            )
        case .camera:
            return String(
                localized: "access_permission.camera.description",
                table: "Foundation",
                comment: "Camera permission description"
            )
        case .microphone:
            return String(
                localized: "access_permission.microphone.description",
                table: "Foundation",
                comment: "Microphone permission description"
            )
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
            return String(
                localized: "access_permission_status.allowed.title",
                table: "Foundation",
                comment: "Permission status title for allowed"
            )
        case .askEveryTime:
            return String(
                localized: "access_permission_status.ask_every_time.title",
                table: "Foundation",
                comment: "Permission status title for ask every time"
            )
        case .blocked:
            return String(
                localized: "access_permission_status.blocked.title",
                table: "Foundation",
                comment: "Permission status title for blocked"
            )
        case .limited:
            return String(
                localized: "access_permission_status.limited.title",
                table: "Foundation",
                comment: "Permission status title for limited"
            )
        case .unavailable:
            return String(
                localized: "access_permission_status.unavailable.title",
                table: "Foundation",
                comment: "Permission status title for unavailable"
            )
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
        guard AVCaptureDevice.default(for: .video) != nil else {
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
        switch AVAudioApplication.shared.recordPermission {
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
        return String(
            localized: "shared.action.request_access",
            table: "Foundation",
            comment: "Permission action title to request access"
        )
    case .allowed, .blocked, .limited:
        return String(
            localized: "shared.action.open_settings",
            table: "Foundation",
            comment: "Permission action title to open Settings"
        )
    case .unavailable:
        return nil
    }
}

func accessPermissionGuidance(kind: AccessPermissionKind, status: AccessPermissionStatus) -> String {
    switch (kind, status) {
    case (.photos, .limited):
        return String(
            localized: "access_permission_guidance.photos.limited",
            table: "Foundation",
            comment: "Guidance when photo permission is limited"
        )
    case (.photos, .blocked):
        return String(
            localized: "access_permission_guidance.photos.blocked",
            table: "Foundation",
            comment: "Guidance when photo permission is blocked"
        )
    case (.camera, .blocked):
        return String(
            localized: "access_permission_guidance.camera.blocked",
            table: "Foundation",
            comment: "Guidance when camera permission is blocked"
        )
    case (.microphone, .blocked):
        return String(
            localized: "access_permission_guidance.microphone.blocked",
            table: "Foundation",
            comment: "Guidance when microphone permission is blocked"
        )
    case (_, .askEveryTime):
        return String(
            localized: "access_permission_guidance.ask_every_time",
            table: "Foundation",
            comment: "Guidance when permission has not been requested yet"
        )
    case (_, .allowed):
        return String(
            localized: "access_permission_guidance.allowed",
            table: "Foundation",
            comment: "Guidance when permission is allowed"
        )
    case (_, .limited):
        return String(
            localized: "access_permission_guidance.limited",
            table: "Foundation",
            comment: "Guidance when permission is limited"
        )
    case (_, .unavailable):
        return String(
            localized: "access_permission_guidance.unavailable",
            table: "Foundation",
            comment: "Guidance when permission is unavailable"
        )
    }
}

/**
 * Requests one OS permission and reports what the person answered.
 *
 * Every caller in the app already asks only when the permission is undetermined, and this checks it
 * again because that is what makes the event honest: an already-decided permission resolves from the
 * stored answer without a dialog being shown, and reporting one then would count dialogs nobody saw.
 * The check is also what keeps that true for a future caller that forgets the gate.
 */
@MainActor
func requestAccessPermission(kind: AccessPermissionKind) async -> AccessPermissionStatus {
    let wasUndecided = accessPermissionStatus(kind: kind) == .askEveryTime
    let status = await performAccessPermissionRequest(kind: kind)
    if wasUndecided, let outcome = analyticsPermissionPromptOutcome(status: status) {
        Analytics.trackPermissionPromptAnswered(
            permission: analyticsPermission(kind: kind),
            outcome: outcome
        )
    }

    return status
}

func analyticsPermission(kind: AccessPermissionKind) -> AnalyticsPermission {
    switch kind {
    case .photos:
        return .photoLibrary
    case .camera:
        return .camera
    case .microphone:
        return .microphone
    }
}

/**
 * Maps a post-request status onto the catalog's three outcomes, or to nothing when no dialog can
 * have produced it.
 *
 * `limited` is a grant: the person allowed the app a chosen set of photos, which is an answer of yes
 * with a scope attached, and the catalog has no narrower value for it. `askEveryTime` means the
 * request came back with the permission still undetermined, which is the person closing the dialog
 * without deciding — reachable from the photos branch of `performAccessPermissionRequest` alone,
 * because the camera and microphone requests answer with a bool and map an undecided close onto
 * `blocked`. `unavailable` is the device having no such hardware, so nothing was ever asked.
 */
func analyticsPermissionPromptOutcome(status: AccessPermissionStatus) -> AnalyticsPermissionOutcome? {
    switch status {
    case .allowed, .limited:
        return .granted
    case .blocked:
        return .denied
    case .askEveryTime:
        return .dismissed
    case .unavailable:
        return nil
    }
}

@MainActor
private func performAccessPermissionRequest(kind: AccessPermissionKind) async -> AccessPermissionStatus {
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
        guard AVCaptureDevice.default(for: .video) != nil else {
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
            AVAudioApplication.requestRecordPermission { granted in
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
