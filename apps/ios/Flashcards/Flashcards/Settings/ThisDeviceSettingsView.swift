import SwiftUI
import UIKit

private let testModeUnlockRequiredTapCount: Int = 5
private let testModeUnlockMaximumTapIntervalSeconds: TimeInterval = 2

struct ThisDeviceSettingsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @State private var appVersionTapCount: Int = 0
    @State private var lastAppVersionTapAt: Date? = nil

    private var deviceModel: String {
        let model = UIDevice.current.model.trimmingCharacters(in: .whitespacesAndNewlines)
        return model.isEmpty ? aiSettingsLocalized("common.unavailable", "Unavailable") : model
    }

    private var operatingSystem: String {
        let currentDevice = UIDevice.current
        return "\(currentDevice.systemName) \(currentDevice.systemVersion)"
    }

    private var appVersion: String {
        appMarketingVersion()
    }

    private var buildNumber: String {
        appBuildNumber()
    }

    private var installationId: String {
        store.cloudSettings?.installationId ?? aiSettingsLocalized("common.unavailable", "Unavailable")
    }

    private var workspaceName: String {
        store.workspace?.name ?? aiSettingsLocalized("common.unavailable", "Unavailable")
    }

    var body: some View {
        List {
            Section(aiSettingsLocalized("settings.thisDevice.section.thisDevice", "Device")) {
                LabeledContent(aiSettingsLocalized("settings.thisDevice.workspace", "Workspace")) {
                    Text(self.workspaceName)
                }

                LabeledContent(aiSettingsLocalized("settings.thisDevice.operatingSystem", "Operating system")) {
                    Text(self.operatingSystem)
                }

                LabeledContent(aiSettingsLocalized("settings.thisDevice.deviceModel", "Device model")) {
                    Text(self.deviceModel)
                }

                LabeledContent(aiSettingsLocalized("settings.thisDevice.appVersion", "App version")) {
                    Text(self.appVersion)
                        .contentShape(Rectangle())
                        .onTapGesture {
                            self.handleAppVersionTap(now: Date())
                        }
                }

                LabeledContent(aiSettingsLocalized("settings.thisDevice.build", "Build")) {
                    Text(self.buildNumber)
                }

                LabeledContent(aiSettingsLocalized("settings.thisDevice.client", "Client")) {
                    Text("SwiftUI")
                }

                LabeledContent(aiSettingsLocalized("settings.thisDevice.storage", "Storage")) {
                    Text("SQLite")
                }

                LabeledContent(aiSettingsLocalized("settings.thisDevice.installationId", "Installation ID")) {
                    Text(self.installationId)
                        .font(.caption.monospaced())
                        .multilineTextAlignment(.trailing)
                }

                Label(
                    aiSettingsLocalized(
                        "settings.thisDevice.note.localOnly",
                        "No login is required to create cards, save decks, or review."
                    ),
                    systemImage: "internaldrive"
                )
                Label(
                    aiSettingsLocalized(
                        "settings.thisDevice.note.syncScope",
                        "Future sync stays scoped to the current workspace only."
                    ),
                    systemImage: "lock.shield"
                )
                Label(
                    aiSettingsLocalized(
                        "settings.thisDevice.note.schema",
                        "The schema stays close to the backend without pulling remote data by default."
                    ),
                    systemImage: "externaldrive.badge.checkmark"
                )
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(aiSettingsLocalized("settings.thisDevice.title", "Device"))
    }

    private func handleAppVersionTap(now: Date) {
        if let lastAppVersionTapAt = self.lastAppVersionTapAt,
           now.timeIntervalSince(lastAppVersionTapAt) <= testModeUnlockMaximumTapIntervalSeconds {
            self.appVersionTapCount += 1
        } else {
            self.appVersionTapCount = 1
        }
        self.lastAppVersionTapAt = now

        guard self.appVersionTapCount >= testModeUnlockRequiredTapCount else {
            return
        }

        self.appVersionTapCount = 0
        self.lastAppVersionTapAt = nil
        self.store.toggleTestMode()
    }
}

#Preview("Default") {
    NavigationStack {
        ThisDeviceSettingsView()
            .environment(FlashcardsStore())
    }
}

#Preview("Arabic RTL") {
    NavigationStack {
        ThisDeviceSettingsView()
            .environment(FlashcardsStore())
    }
    .arabicRTLPreview()
}
