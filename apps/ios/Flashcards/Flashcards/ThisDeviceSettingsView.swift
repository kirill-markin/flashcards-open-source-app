import SwiftUI
import UIKit

struct ThisDeviceSettingsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    private var deviceModel: String {
        let model = UIDevice.current.model.trimmingCharacters(in: .whitespacesAndNewlines)
        return model.isEmpty ? "Unavailable" : model
    }

    private var operatingSystem: String {
        let currentDevice = UIDevice.current
        return "\(currentDevice.systemName) \(currentDevice.systemVersion)"
    }

    private var appVersion: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        return version ?? "Unavailable"
    }

    private var buildNumber: String {
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String
        return build ?? "Unavailable"
    }

    private var deviceId: String {
        store.cloudSettings?.deviceId ?? "Unavailable"
    }

    private var workspaceName: String {
        store.workspace?.name ?? "Unavailable"
    }

    var body: some View {
        List {
            Section("This Device") {
                LabeledContent("Workspace") {
                    Text(self.workspaceName)
                }

                LabeledContent("Operating system") {
                    Text(self.operatingSystem)
                }

                LabeledContent("Device model") {
                    Text(self.deviceModel)
                }

                LabeledContent("App version") {
                    Text(self.appVersion)
                }

                LabeledContent("Build") {
                    Text(self.buildNumber)
                }

                LabeledContent("Client") {
                    Text("SwiftUI")
                }

                LabeledContent("Storage") {
                    Text("SQLite")
                }

                LabeledContent("Device ID") {
                    Text(self.deviceId)
                        .font(.caption.monospaced())
                        .multilineTextAlignment(.trailing)
                }

                Label("No login is required to create cards, save decks, or review.", systemImage: "internaldrive")
                Label("Future sync stays scoped to the current workspace only.", systemImage: "lock.shield")
                Label("The schema stays close to the backend without pulling remote data by default.", systemImage: "externaldrive.badge.checkmark")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("This Device")
    }
}

#Preview {
    NavigationStack {
        ThisDeviceSettingsView()
            .environment(FlashcardsStore())
    }
}
