import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: FlashcardsStore

    @State private var screenErrorMessage: String = ""
    @State private var desiredRetentionText: String = ""
    @State private var learningStepsText: String = ""
    @State private var relearningStepsText: String = ""
    @State private var maximumIntervalDaysText: String = ""
    @State private var enableFuzz: Bool = true

    var body: some View {
        List {
            if store.globalErrorMessage.isEmpty == false {
                Section {
                    Text(store.globalErrorMessage)
                        .foregroundStyle(.red)
                }
            }

            if screenErrorMessage.isEmpty == false {
                Section {
                    Text(screenErrorMessage)
                        .foregroundStyle(.red)
                }
            }

            Section("App") {
                LabeledContent("Client") {
                    Text("SwiftUI + SQLite")
                }

                LabeledContent("Workspace") {
                    Text(store.workspace?.name ?? "Unavailable")
                }

                LabeledContent("Cards") {
                    Text("\(store.homeSnapshot.totalCards)")
                }

                LabeledContent("Decks") {
                    Text("\(store.homeSnapshot.deckCount)")
                }
            }

            Section("Cloud account") {
                if let cloudSettings = store.cloudSettings {
                    LabeledContent("State") {
                        Text(cloudSettings.cloudState.title)
                    }

                    LabeledContent("Device ID") {
                        Text(cloudSettings.deviceId)
                            .font(.caption.monospaced())
                            .multilineTextAlignment(.trailing)
                    }

                    if let linkedEmail = cloudSettings.linkedEmail {
                        LabeledContent("Linked email") {
                            Text(linkedEmail)
                        }
                    }

                    LabeledContent("Sync status") {
                        Text(syncStatusTitle(status: store.syncStatus))
                    }

                    if let lastSuccessfulCloudSyncAt = store.lastSuccessfulCloudSyncAt {
                        LabeledContent("Last sync") {
                            Text(lastSuccessfulCloudSyncAt)
                                .font(.caption.monospaced())
                                .multilineTextAlignment(.trailing)
                        }
                    }

                    Text("Local mode always works. Once auth provides a linked cloud session, the app pushes pending writes and pulls ordered changes for the current workspace.")
                        .foregroundStyle(.secondary)

                    switch cloudSettings.cloudState {
                    case .disconnected:
                        Button("Prepare cloud link") {
                            self.prepareCloudLink()
                        }
                    case .linkingReady:
                        Button("Preview linked state") {
                            self.previewLinkedState()
                        }

                        Button("Reset local cloud state", role: .destructive) {
                            self.disconnectCloudAccount()
                        }
                    case .linked:
                        Button("Sync now") {
                            self.syncNow()
                        }
                        .disabled(isSyncInFlight(status: store.syncStatus))

                        Button("Disconnect cloud account", role: .destructive) {
                            self.disconnectCloudAccount()
                        }
                    }
                } else {
                    Text("Cloud settings are unavailable.")
                        .foregroundStyle(.secondary)
                }
            }

            Section("Scheduler") {
                if let schedulerSettings = store.schedulerSettings {
                    LabeledContent("Algorithm") {
                        Text(schedulerSettings.algorithm.uppercased())
                    }

                    TextField("Desired retention", text: self.$desiredRetentionText)
                        .keyboardType(.decimalPad)

                    TextField("Learning steps (minutes)", text: self.$learningStepsText)
                        .textInputAutocapitalization(.never)

                    TextField("Relearning steps (minutes)", text: self.$relearningStepsText)
                        .textInputAutocapitalization(.never)

                    TextField("Maximum interval (days)", text: self.$maximumIntervalDaysText)
                        .keyboardType(.numberPad)

                    Toggle("Enable fuzz", isOn: self.$enableFuzz)

                    Button("Save scheduler settings") {
                        self.saveSchedulerSettings()
                    }

                    Text("These settings affect future scheduling only. Existing card state remains authoritative.")
                        .foregroundStyle(.secondary)

                    LabeledContent("Updated") {
                        Text(schedulerSettings.updatedAt)
                            .font(.caption.monospaced())
                            .multilineTextAlignment(.trailing)
                    }
                } else {
                    Text("Scheduler settings are unavailable.")
                        .foregroundStyle(.secondary)
                }
            }

            Section("Local data") {
                Label("No login is required to create cards, save decks, or review.", systemImage: "internaldrive")
                Label("Future sync stays scoped to the current workspace only.", systemImage: "lock.shield")
                Label("The schema stays close to the backend without pulling remote data by default.", systemImage: "externaldrive.badge.checkmark")
            }

            Section("Today") {
                LabeledContent("Due") {
                    Text("\(store.homeSnapshot.dueCount)")
                }

                LabeledContent("New") {
                    Text("\(store.homeSnapshot.newCount)")
                }

                LabeledContent("Reviewed") {
                    Text("\(store.homeSnapshot.reviewedCount)")
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Settings")
        .onAppear {
            self.loadSchedulerDrafts(settings: store.schedulerSettings)
        }
        .onChange(of: store.schedulerSettings) { _, newSettings in
            self.loadSchedulerDrafts(settings: newSettings)
        }
    }

    private func prepareCloudLink() {
        do {
            try store.prepareCloudLink()
            self.screenErrorMessage = ""
        } catch {
            self.screenErrorMessage = localizedMessage(error: error)
        }
    }

    private func previewLinkedState() {
        do {
            try store.previewLinkedCloudAccount()
            self.screenErrorMessage = ""
        } catch {
            self.screenErrorMessage = localizedMessage(error: error)
        }
    }

    private func disconnectCloudAccount() {
        do {
            try store.disconnectCloudAccount()
            self.screenErrorMessage = ""
        } catch {
            self.screenErrorMessage = localizedMessage(error: error)
        }
    }

    private func syncNow() {
        Task { @MainActor in
            do {
                try await store.syncCloudNow()
                self.screenErrorMessage = ""
            } catch {
                self.screenErrorMessage = localizedMessage(error: error)
            }
        }
    }

    private func loadSchedulerDrafts(settings: WorkspaceSchedulerSettings?) {
        guard let settings else {
            return
        }

        self.desiredRetentionText = formatRetentionValue(settings.desiredRetention)
        self.learningStepsText = formatStepList(settings.learningStepsMinutes)
        self.relearningStepsText = formatStepList(settings.relearningStepsMinutes)
        self.maximumIntervalDaysText = String(settings.maximumIntervalDays)
        self.enableFuzz = settings.enableFuzz
    }

    private func saveSchedulerSettings() {
        do {
            let desiredRetention = try parseDesiredRetention(text: self.desiredRetentionText)
            let learningStepsMinutes = try parseSchedulerStepList(
                text: self.learningStepsText,
                fieldName: "Learning steps"
            )
            let relearningStepsMinutes = try parseSchedulerStepList(
                text: self.relearningStepsText,
                fieldName: "Relearning steps"
            )
            let maximumIntervalDays = try parsePositiveInteger(
                text: self.maximumIntervalDaysText,
                fieldName: "Maximum interval"
            )

            try store.updateSchedulerSettings(
                desiredRetention: desiredRetention,
                learningStepsMinutes: learningStepsMinutes,
                relearningStepsMinutes: relearningStepsMinutes,
                maximumIntervalDays: maximumIntervalDays,
                enableFuzz: self.enableFuzz
            )
            self.screenErrorMessage = ""
        } catch {
            self.screenErrorMessage = localizedMessage(error: error)
        }
    }
}

private func syncStatusTitle(status: SyncStatus) -> String {
    switch status {
    case .idle:
        return "Idle"
    case .syncing:
        return "Syncing"
    case .failed(let message):
        return "Failed: \(message)"
    }
}

private func isSyncInFlight(status: SyncStatus) -> Bool {
    switch status {
    case .syncing:
        return true
    case .idle, .failed:
        return false
    }
}

private func formatStepList(_ values: [Int]) -> String {
    values.map(String.init).joined(separator: ", ")
}

private func formatRetentionValue(_ value: Double) -> String {
    String(format: "%.2f", value)
}

private func parseDesiredRetention(text: String) throws -> Double {
    let normalizedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: ",", with: ".")

    guard let value = Double(normalizedText) else {
        throw LocalStoreError.validation("Desired retention must be a decimal number")
    }

    return value
}

private func parsePositiveInteger(text: String, fieldName: String) throws -> Int {
    let normalizedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let value = Int(normalizedText), value > 0 else {
        throw LocalStoreError.validation("\(fieldName) must be a positive integer")
    }

    return value
}

private func parseSchedulerStepList(text: String, fieldName: String) throws -> [Int] {
    let parts = text
        .split(separator: ",")
        .map { value in
            value.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        .filter { value in
            value.isEmpty == false
        }

    if parts.isEmpty {
        throw LocalStoreError.validation("\(fieldName) must not be empty")
    }

    return try parts.map { value in
        guard let step = Int(value) else {
            throw LocalStoreError.validation("\(fieldName) must contain integers")
        }

        return step
    }
}

#Preview {
    NavigationStack {
        SettingsView()
            .environmentObject(FlashcardsStore())
    }
}
