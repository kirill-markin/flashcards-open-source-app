import SwiftUI

struct SchedulerSettingsDetailView: View {
    @EnvironmentObject private var store: FlashcardsStore

    @State private var screenErrorMessage: String = ""
    @State private var draft: SchedulerSettingsDraft = makeDefaultSchedulerSettingsDraft()
    @State private var isSaveConfirmationPresented: Bool = false
    @State private var pendingSchedulerSettingsUpdate: PendingSchedulerSettingsUpdate?
    @FocusState private var focusedField: FocusedField?

    private enum FocusedField: Hashable {
        case desiredRetention
        case learningSteps
        case relearningSteps
        case maximumIntervalDays
    }

    private var isResetDisabled: Bool {
        self.draft == makeDefaultSchedulerSettingsDraft()
    }

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
                    schedulerInfoRow(
                        title: "Algorithm",
                        value: schedulerSettings.algorithm.uppercased(),
                        note: "FSRS-6 is fixed in v1 and cannot be changed."
                    )

                    schedulerTextFieldRow(
                        title: "Desired retention",
                        prompt: "0.90",
                        text: self.$draft.desiredRetentionText,
                        focusedField: self.$focusedField,
                        field: .desiredRetention,
                        note: "Higher values shorten intervals and increase review frequency. Lower values lengthen intervals and increase forgetting risk.",
                        keyboardType: .decimalPad,
                        autocapitalization: .sentences
                    )

                    schedulerTextFieldRow(
                        title: "Learning steps (minutes)",
                        prompt: "1, 10",
                        text: self.$draft.learningStepsText,
                        focusedField: self.$focusedField,
                        field: .learningSteps,
                        note: "Short-term minute steps for new cards before they graduate. More or longer steps keep cards in learning longer.",
                        keyboardType: .numbersAndPunctuation,
                        autocapitalization: .never
                    )

                    schedulerTextFieldRow(
                        title: "Relearning steps (minutes)",
                        prompt: "10",
                        text: self.$draft.relearningStepsText,
                        focusedField: self.$focusedField,
                        field: .relearningSteps,
                        note: "Short-term minute steps after a failed review. More or longer steps keep lapsed cards in relearning longer.",
                        keyboardType: .numbersAndPunctuation,
                        autocapitalization: .never
                    )

                    schedulerTextFieldRow(
                        title: "Maximum interval (days)",
                        prompt: "36500",
                        text: self.$draft.maximumIntervalDaysText,
                        focusedField: self.$focusedField,
                        field: .maximumIntervalDays,
                        note: "Hard cap for long-term intervals. Lower values bring mature cards back sooner.",
                        keyboardType: .numberPad,
                        autocapitalization: .sentences
                    )

                    VStack(alignment: .leading, spacing: 8) {
                        Toggle("Enable fuzz", isOn: self.$draft.enableFuzz)

                        SchedulerSettingNote(text: "Slightly spreads due dates to avoid clusters. Disable it for more predictable but more concentrated schedules.")
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Updated")
                            .font(.headline)

                        Text(schedulerSettings.updatedAt)
                            .font(.caption.monospaced())
                    }
                }

                Section("Actions") {
                    Button("Save scheduler settings") {
                        self.requestSchedulerSettingsSave()
                    }

                    Button("Reset to defaults") {
                        self.resetSchedulerSettingsDraft()
                    }
                    .disabled(self.isResetDisabled)

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
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()

                Button("Done") {
                    self.focusedField = nil
                }
            }
        }
        .alert(
            "Apply scheduler settings?",
            isPresented: self.$isSaveConfirmationPresented,
            presenting: self.pendingSchedulerSettingsUpdate
        ) { pendingUpdate in
            Button("Cancel", role: .cancel) {
                self.pendingSchedulerSettingsUpdate = nil
            }

            Button("Apply") {
                self.applySchedulerSettingsUpdate(update: pendingUpdate)
            }
        } message: { _ in
            Text("Changing scheduler settings is not recommended unless you have a specific reason. It affects future reviews only and does not rewrite existing card state.")
        }
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

    private func requestSchedulerSettingsSave() {
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

            self.pendingSchedulerSettingsUpdate = PendingSchedulerSettingsUpdate(
                desiredRetention: desiredRetention,
                learningStepsMinutes: learningStepsMinutes,
                relearningStepsMinutes: relearningStepsMinutes,
                maximumIntervalDays: maximumIntervalDays,
                enableFuzz: self.draft.enableFuzz
            )
            self.isSaveConfirmationPresented = true
            self.screenErrorMessage = ""
        } catch {
            self.screenErrorMessage = Flashcards.errorMessage(error: error)
        }
    }

    private func applySchedulerSettingsUpdate(update: PendingSchedulerSettingsUpdate) {
        do {
            try store.updateSchedulerSettings(
                desiredRetention: update.desiredRetention,
                learningStepsMinutes: update.learningStepsMinutes,
                relearningStepsMinutes: update.relearningStepsMinutes,
                maximumIntervalDays: update.maximumIntervalDays,
                enableFuzz: update.enableFuzz
            )
            self.pendingSchedulerSettingsUpdate = nil
            self.screenErrorMessage = ""
        } catch {
            self.pendingSchedulerSettingsUpdate = nil
            self.screenErrorMessage = Flashcards.errorMessage(error: error)
        }
    }

    private func resetSchedulerSettingsDraft() {
        self.draft = makeDefaultSchedulerSettingsDraft()
        self.screenErrorMessage = ""
    }

    private func schedulerInfoRow(title: String, value: String, note: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)

            Text(value)

            SchedulerSettingNote(text: note)
        }
    }

    private func schedulerTextFieldRow(
        title: String,
        prompt: String,
        text: Binding<String>,
        focusedField: FocusState<FocusedField?>.Binding,
        field: FocusedField,
        note: String,
        keyboardType: UIKeyboardType,
        autocapitalization: TextInputAutocapitalization
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)

            TextField(prompt, text: text)
                .keyboardType(keyboardType)
                .textInputAutocapitalization(autocapitalization)
                .focused(focusedField, equals: field)
                .submitLabel(.done)
                .onSubmit {
                    focusedField.wrappedValue = nil
                }

            SchedulerSettingNote(text: note)
        }
    }
}

private struct PendingSchedulerSettingsUpdate {
    let desiredRetention: Double
    let learningStepsMinutes: [Int]
    let relearningStepsMinutes: [Int]
    let maximumIntervalDays: Int
    let enableFuzz: Bool
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
