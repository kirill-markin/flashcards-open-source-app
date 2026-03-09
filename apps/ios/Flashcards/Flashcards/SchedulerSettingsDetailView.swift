import SwiftUI

struct SchedulerSettingsDetailView: View {
    @EnvironmentObject private var store: FlashcardsStore

    @State private var screenErrorMessage: String = ""
    @State private var draft: SchedulerSettingsDraft = makeDefaultSchedulerSettingsDraft()

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

            if let schedulerSettings = store.schedulerSettings {
                Section("Scheduler") {
                    LabeledContent("Algorithm") {
                        Text(schedulerSettings.algorithm.uppercased())
                    }

                    SchedulerSettingNote(text: "FSRS-6 is fixed in v1 and cannot be changed.")

                    TextField("Desired retention", text: self.$draft.desiredRetentionText)
                        .keyboardType(.decimalPad)

                    SchedulerSettingNote(text: "Higher values shorten intervals and increase review frequency. Lower values lengthen intervals and increase forgetting risk.")

                    TextField("Learning steps (minutes)", text: self.$draft.learningStepsText)
                        .textInputAutocapitalization(.never)

                    SchedulerSettingNote(text: "Short-term minute steps for new cards before they graduate. More or longer steps keep cards in learning longer.")

                    TextField("Relearning steps (minutes)", text: self.$draft.relearningStepsText)
                        .textInputAutocapitalization(.never)

                    SchedulerSettingNote(text: "Short-term minute steps after a failed review. More or longer steps keep lapsed cards in relearning longer.")

                    TextField("Maximum interval (days)", text: self.$draft.maximumIntervalDaysText)
                        .keyboardType(.numberPad)

                    SchedulerSettingNote(text: "Hard cap for long-term intervals. Lower values bring mature cards back sooner.")

                    Toggle("Enable fuzz", isOn: self.$draft.enableFuzz)

                    SchedulerSettingNote(text: "Slightly spreads due dates to avoid clusters. Disable it for more predictable but more concentrated schedules.")

                    LabeledContent("Updated") {
                        Text(schedulerSettings.updatedAt)
                            .font(.caption.monospaced())
                            .multilineTextAlignment(.trailing)
                    }
                }

                Section("Actions") {
                    Button("Save scheduler settings") {
                        self.saveSchedulerSettings()
                    }

                    Button("Reset to defaults") {
                        self.resetSchedulerSettingsDraft()
                    }

                    Text("Reset fills the default values in the form. Tap Save to apply. This affects future reviews only.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            } else {
                Section("Scheduler") {
                    Text("Scheduler settings are unavailable.")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Scheduler settings")
        .onAppear {
            self.loadSchedulerDraft(settings: store.schedulerSettings)
        }
        .onChange(of: store.schedulerSettings) { _, newSettings in
            self.loadSchedulerDraft(settings: newSettings)
        }
    }

    private func loadSchedulerDraft(settings: WorkspaceSchedulerSettings?) {
        guard let settings else {
            return
        }

        self.draft = makeSchedulerSettingsDraft(settings: settings)
    }

    private func saveSchedulerSettings() {
        do {
            let desiredRetention = try parseSchedulerDesiredRetention(text: self.draft.desiredRetentionText)
            let learningStepsMinutes = try parseSchedulerStepList(
                text: self.draft.learningStepsText,
                fieldName: "Learning steps"
            )
            let relearningStepsMinutes = try parseSchedulerStepList(
                text: self.draft.relearningStepsText,
                fieldName: "Relearning steps"
            )
            let maximumIntervalDays = try parseSchedulerPositiveInteger(
                text: self.draft.maximumIntervalDaysText,
                fieldName: "Maximum interval"
            )

            try store.updateSchedulerSettings(
                desiredRetention: desiredRetention,
                learningStepsMinutes: learningStepsMinutes,
                relearningStepsMinutes: relearningStepsMinutes,
                maximumIntervalDays: maximumIntervalDays,
                enableFuzz: self.draft.enableFuzz
            )
            self.screenErrorMessage = ""
        } catch {
            self.screenErrorMessage = localizedMessage(error: error)
        }
    }

    private func resetSchedulerSettingsDraft() {
        self.draft = makeDefaultSchedulerSettingsDraft()
        self.screenErrorMessage = ""
    }
}

private struct SchedulerSettingNote: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(.secondary)
    }
}

#Preview {
    NavigationStack {
        SchedulerSettingsDetailView()
            .environmentObject(FlashcardsStore())
    }
}
