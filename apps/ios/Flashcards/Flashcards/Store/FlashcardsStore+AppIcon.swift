import Foundation
import UIKit

private let appIconSelectionUserDefaultsKey: String = "app-icon-selection"

/// Home Screen icons. A new icon is one more case, its `.icon` document listed in
/// `ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES`, and a preview image set.
enum AppIconOption: String, CaseIterable, Identifiable, Sendable {
    case `default` = "default"
    case light = "light"

    var id: String {
        self.rawValue
    }

    /// The name `UIApplication.setAlternateIconName(_:)` takes; `nil` is the primary `AppIcon`.
    var alternateIconName: String? {
        switch self {
        case .default:
            return nil
        case .light:
            return "AppIcon-Light"
        }
    }

    var previewImageName: String {
        switch self {
        case .default:
            return "AppIconPreviewDefault"
        case .light:
            return "AppIconPreviewLight"
        }
    }

    var title: String {
        switch self {
        case .default:
            return aiSettingsLocalized("settings.appIcon.default", "Default")
        case .light:
            return aiSettingsLocalized("settings.appIcon.light", "Light")
        }
    }
}

func loadAppIconSelection(userDefaults: UserDefaults) -> AppIconOption {
    guard let rawValue = userDefaults.string(forKey: appIconSelectionUserDefaultsKey) else {
        return .default
    }

    // An unknown value was written by a newer build whose icon this build does not ship.
    return AppIconOption(rawValue: rawValue) ?? .default
}

private func persistAppIconSelection(userDefaults: UserDefaults, option: AppIconOption) -> Void {
    userDefaults.set(option.rawValue, forKey: appIconSelectionUserDefaultsKey)
}

extension FlashcardsStore {
    var effectiveAppIcon: AppIconOption {
        self.canCustomizeStyle ? self.appIconSelection : .default
    }

    func updateAppIconSelection(option: AppIconOption) throws -> Void {
        guard option == .default || self.canCustomizeStyle else {
            throw LocalStoreError.validation("Changing the app icon requires Premium")
        }
        self.appIconSelection = option
        persistAppIconSelection(userDefaults: self.userDefaults, option: option)
        self.applyEffectiveAppIcon()
    }

    /**
     Makes the Home Screen icon match `effectiveAppIcon`. Every call iOS accepts shows its own confirmation alert, so
     this calls it only while the app is active, the current icon differs, and no change is already in flight; a
     skipped or failed change is applied on the next call, such as the next time the scene becomes active.
     */
    func applyEffectiveAppIcon() -> Void {
        let target = self.effectiveAppIcon
        guard UIApplication.shared.applicationState == .active,
              self.isAppIconChangeInFlight == false,
              UIApplication.shared.alternateIconName != target.alternateIconName else {
            return
        }

        self.isAppIconChangeInFlight = true
        Task { @MainActor in
            do {
                try await UIApplication.shared.setAlternateIconName(target.alternateIconName)
                self.isAppIconChangeInFlight = false
                // The selection or entitlement may have moved while the alert was up.
                self.applyEffectiveAppIcon()
            } catch {
                self.isAppIconChangeInFlight = false
                FlashcardsObservability.captureSilentFailure(
                    error: error,
                    scope: IOSObservationScope(
                        feature: .appIcon,
                        userId: self.cloudSettings?.linkedUserId,
                        workspaceId: self.workspace?.workspaceId,
                        requestId: nil,
                        clientRequestId: nil,
                        sessionId: nil,
                        runId: nil,
                        cloudState: self.cloudSettings?.cloudState,
                        configurationMode: try? self.currentCloudServiceConfiguration().mode
                    ),
                    action: "app_icon_apply",
                    stage: "set_alternate_icon_name_\(target.rawValue)",
                    statusCode: nil,
                    backendCode: nil,
                    requestId: nil
                )
            }
        }
    }
}
