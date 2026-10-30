import Foundation

// There is no en.lproj/AISettings.strings: `defaultValue` is the English copy,
// so every non-English locale needs a complete <locale>.lproj/AISettings.strings.
private let aiSettingsLocalizationTable: String = "AISettings"

func aiSettingsLocalized(_ key: String, _ defaultValue: String) -> String {
    Bundle.main.localizedString(
        forKey: key,
        value: defaultValue,
        table: aiSettingsLocalizationTable
    )
}

func aiSettingsLocalizedFormat(_ key: String, _ defaultValue: String, _ arguments: CVarArg...) -> String {
    let format = aiSettingsLocalized(key, defaultValue)
    return String(format: format, locale: Locale.current, arguments: arguments)
}

func localizedAIChatAccuracyWarningText(_ text: String) -> String {
    guard text == aiChatAccuracyWarningText else {
        return text
    }

    return aiSettingsLocalized(
        "ai.warning.accuracy",
        "AI responses can be inaccurate or incomplete. Review important results before relying on them."
    )
}

func localizedCloudAccountStateTitle(_ cloudState: CloudAccountState) -> String {
    switch cloudState {
    case .disconnected:
        return aiSettingsLocalized("cloud.state.disconnected", "Disconnected")
    case .linkingReady:
        return aiSettingsLocalized("cloud.state.linkingReady", "Linking ready")
    case .guest:
        return aiSettingsLocalized("cloud.state.guest", "Guest")
    case .linked:
        return aiSettingsLocalized("cloud.state.linked", "Linked")
    }
}

func localizedCloudCredentialRecoveryBlockedMessage(reason: CloudCredentialRecoveryReason) -> String {
    switch reason {
    case .linkedCredentialsMissing:
        return aiSettingsLocalized(
            "settings.sync.recovery.linkedCredentialsMissing",
            "Secure sign-in credentials are missing on this device. Local data is preserved. Sign in again to reconnect sync."
        )
    case .linkedWorkspaceUnavailable:
        return aiSettingsLocalized(
            "settings.sync.recovery.linkedWorkspaceUnavailable",
            "Cloud access to the linked workspace changed. Local data is preserved. Sign in again after the original account and workspace access are restored."
        )
    case .guestSessionMissing:
        return aiSettingsLocalized(
            "settings.sync.recovery.guestSessionMissing",
            "Guest credentials are missing on this device. Local data is preserved, but the old guest cloud account cannot be recovered without its token."
        )
    case .invalidStoredState:
        return aiSettingsLocalized(
            "settings.sync.recovery.invalidStoredState",
            "Cloud credential recovery data stored on this device is invalid. Sync is paused until you reconnect or reset cloud identity."
        )
    }
}

func localizedCustomGuestWorkspacePauseMessage() -> String {
    aiSettingsLocalized(
        "settings.sync.customGuestWorkspacePaused.message",
        "This custom server cannot access this guest workspace. The server may be incompatible or misconfigured. Sync is paused, and your local cards and pending changes are safe on this device."
    )
}

func localizedCloudCredentialRecoveryWrongLinkedAccountMessage() -> String {
    aiSettingsLocalized(
        "settings.sync.recovery.wrongLinkedAccount",
        "Sign in with the original cloud account to reconnect preserved local data."
    )
}

func localizedCloudCredentialRecoveryWrongLinkedWorkspaceMessage() -> String {
    aiSettingsLocalized(
        "settings.sync.recovery.wrongLinkedWorkspace",
        "Select the original cloud workspace to reconnect preserved local data."
    )
}

func localizedCloudCredentialRecoveryInterruptedUpgradeAccountMessage() -> String {
    aiSettingsLocalized(
        "settings.sync.recovery.interruptedUpgradeAccount",
        "Sign in with the account used for the interrupted account upgrade."
    )
}

func localizedCloudCredentialRecoveryUpgradeWorkspaceMessage(workspaceName: String) -> String {
    aiSettingsLocalizedFormat(
        "settings.sync.recovery.upgradeWorkspace",
        "Account upgrade recovery must finish in workspace %@.",
        workspaceName
    )
}

func localizedAccessPermissionKindTitle(_ kind: AccessPermissionKind) -> String {
    switch kind {
    case .photos:
        return aiSettingsLocalized("settings.access.kind.photos", "Photos")
    case .camera:
        return aiSettingsLocalized("settings.access.kind.camera", "Camera")
    case .microphone:
        return aiSettingsLocalized("settings.access.kind.microphone", "Microphone")
    }
}

func localizedAccessPermissionDescription(_ kind: AccessPermissionKind) -> String {
    switch kind {
    case .photos:
        return aiSettingsLocalized("settings.access.description.photos", "Photo library access is separate from AI attachments. The photo picker shares only the photos you choose.")
    case .camera:
        return aiSettingsLocalized("settings.access.description.camera", "Take photos for AI chat. Photos you attach are sent to OpenAI for AI processing.")
    case .microphone:
        return aiSettingsLocalized("settings.access.description.microphone", "Record dictation audio and send it to OpenAI to transcribe text for AI chat.")
    }
}

func localizedAccessPermissionStatusTitle(_ status: AccessPermissionStatus) -> String {
    switch status {
    case .allowed:
        return aiSettingsLocalized("settings.access.status.allowed", "Allowed")
    case .askEveryTime:
        return aiSettingsLocalized("settings.access.status.askEveryTime", "Ask every time")
    case .blocked:
        return aiSettingsLocalized("settings.access.status.blocked", "Blocked")
    case .limited:
        return aiSettingsLocalized("settings.access.status.limited", "Limited")
    case .unavailable:
        return aiSettingsLocalized("settings.access.status.unavailable", "Unavailable")
    }
}

func localizedAccessPermissionPrimaryActionTitle(_ status: AccessPermissionStatus) -> String? {
    switch status {
    case .askEveryTime:
        return aiSettingsLocalized("settings.access.action.request", "Request access")
    case .allowed, .blocked, .limited:
        return aiSettingsLocalized("settings.access.action.openSettings", "Open Settings")
    case .unavailable:
        return nil
    }
}

func localizedAccessPermissionGuidance(kind: AccessPermissionKind, status: AccessPermissionStatus) -> String {
    switch (kind, status) {
    case (.photos, .limited):
        #if targetEnvironment(macCatalyst)
        return aiSettingsLocalized(
            "settings.access.guidance.mac.photos.limited",
            "Library access is limited. You can still choose photos for AI attachments, or open System Settings > Privacy & Security > Photos to change it."
        )
        #else
        return aiSettingsLocalized(
            "settings.access.guidance.photos.limited",
            "Library access is limited. You can still choose photos for AI attachments."
        )
        #endif
    case (.photos, .blocked):
        #if targetEnvironment(macCatalyst)
        return aiSettingsLocalized(
            "settings.access.guidance.mac.photos.blocked",
            "Library access is off. You can still choose photos for AI attachments, or open System Settings > Privacy & Security > Photos to change it."
        )
        #else
        return aiSettingsLocalized(
            "settings.access.guidance.photos.blocked",
            "Library access is off. You can still choose photos for AI attachments."
        )
        #endif
    case (.camera, .blocked):
        #if targetEnvironment(macCatalyst)
        return aiSettingsLocalized(
            "settings.access.guidance.mac.camera.blocked",
            "Camera access is turned off for Nibomo. Open System Settings > Privacy & Security > Camera to change it."
        )
        #else
        return aiSettingsLocalized(
            "settings.access.guidance.camera.blocked",
            "Camera access is turned off for Nibomo. Open Settings > Privacy & Security > Camera to change it."
        )
        #endif
    case (.microphone, .blocked):
        #if targetEnvironment(macCatalyst)
        return aiSettingsLocalized(
            "settings.access.guidance.mac.microphone.blocked",
            "Microphone access is turned off for Nibomo. Open System Settings > Privacy & Security > Microphone to change it."
        )
        #else
        return aiSettingsLocalized(
            "settings.access.guidance.microphone.blocked",
            "Microphone access is turned off for Nibomo. Open Settings > Privacy & Security > Microphone to change it."
        )
        #endif
    case (_, .askEveryTime):
        #if targetEnvironment(macCatalyst)
        return aiSettingsLocalized(
            "settings.access.guidance.mac.askEveryTime",
            "Request access now, or open System Settings later if you want to manage it manually."
        )
        #else
        return aiSettingsLocalized(
            "settings.access.guidance.askEveryTime",
            "Request access now, or open Settings later if you want to manage it manually."
        )
        #endif
    case (_, .allowed):
        #if targetEnvironment(macCatalyst)
        return aiSettingsLocalized(
            "settings.access.guidance.mac.allowed",
            "Open System Settings > Privacy & Security if you want to turn this access off."
        )
        #else
        return aiSettingsLocalized(
            "settings.access.guidance.allowed",
            "Open Settings if you want to turn this access off."
        )
        #endif
    case (_, .limited):
        return aiSettingsLocalized(
            "settings.access.guidance.limited",
            "Open Settings to review or expand this access."
        )
    case (_, .unavailable):
        return aiSettingsLocalized(
            "settings.access.guidance.unavailable",
            "This access is unavailable on the current device."
        )
    }
}

func localizedReviewNotificationPermissionStatusTitle(_ status: ReviewNotificationPermissionStatus) -> String {
    switch status {
    case .allowed:
        return aiSettingsLocalized("settings.notifications.permission.allowed", "Allowed")
    case .notRequested:
        return aiSettingsLocalized("settings.notifications.permission.notRequested", "Not requested")
    case .blocked:
        return aiSettingsLocalized("settings.notifications.permission.blocked", "Blocked")
    }
}

func localizedReviewNotificationPermissionActionTitle(_ status: ReviewNotificationPermissionStatus) -> String {
    switch status {
    case .allowed, .blocked:
        return aiSettingsLocalized("settings.notifications.permission.action.openSettings", "Open Settings")
    case .notRequested:
        return aiSettingsLocalized("settings.notifications.permission.action.allow", "Allow Notifications")
    }
}

func localizedReviewNotificationModeTitle(_ mode: ReviewNotificationMode) -> String {
    switch mode {
    case .daily:
        return aiSettingsLocalized("settings.notifications.mode.daily", "Once daily")
    case .inactivity:
        return aiSettingsLocalized("settings.notifications.mode.inactivity", "After a break")
    }
}

func localizedAIAttachmentMenuActionTitle(_ action: AIChatAttachmentMenuAction) -> String {
    switch action {
    case .takePhoto:
        return aiSettingsLocalized("ai.composer.attachment.takePhoto", "Take Photo")
    case .choosePhoto:
        return aiSettingsLocalized("ai.composer.attachment.choosePhoto", "Choose Photo")
    case .chooseFile:
        return aiSettingsLocalized("ai.composer.attachment.chooseFile", "Choose File")
    }
}

func premiumOfferTitle() -> String {
    aiSettingsLocalized("premium.offer.title", "Premium")
}

func premiumAILimitTitle() -> String {
    aiSettingsLocalized("premium.aiLimit.title", "AI message limit reached")
}
