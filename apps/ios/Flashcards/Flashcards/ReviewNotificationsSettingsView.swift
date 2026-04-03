import SwiftUI

struct ReviewNotificationsSettingsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    @State private var permissionStatus: ReviewNotificationPermissionStatus = .notRequested
    @State private var permissionErrorMessage: String = ""

    var body: some View {
        List {
            if self.permissionErrorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: self.permissionErrorMessage)
                }
            }

            Section {
                Text("Notification settings stay attached to this workspace, but they apply only to the current device. Study reminders contain cards only and never marketing messages.")
                    .foregroundStyle(.secondary)
            }

            Section("Permission") {
                LabeledContent("Status") {
                    Text(self.permissionStatus.title)
                }

                Button(self.permissionStatus.actionTitle) {
                    self.handlePermissionAction()
                }
            }

            Section("Review Reminders") {
                Toggle(
                    "Enable reminders",
                    isOn: Binding(
                        get: {
                            store.reviewNotificationsSettings.isEnabled
                        },
                        set: { isEnabled in
                            store.updateReviewNotificationsEnabled(isEnabled: isEnabled)
                        }
                    )
                )

                Picker(
                    "Mode",
                    selection: Binding(
                        get: {
                            store.reviewNotificationsSettings.selectedMode
                        },
                        set: { selectedMode in
                            store.updateReviewNotificationsMode(selectedMode: selectedMode)
                        }
                    )
                ) {
                    ForEach(ReviewNotificationMode.allCases) { mode in
                        Text(mode.title).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
            }

            if store.reviewNotificationsSettings.selectedMode == .daily {
                Section("Daily Reminder") {
                    Text("Example: send one card every day at the selected local time.")
                        .foregroundStyle(.secondary)

                    DatePicker(
                        "Time",
                        selection: Binding(
                            get: {
                                makeTimeOnlyDate(
                                    hour: store.reviewNotificationsSettings.daily.hour,
                                    minute: store.reviewNotificationsSettings.daily.minute
                                )
                            },
                            set: { nextDate in
                                let components = Calendar.autoupdatingCurrent.dateComponents([.hour, .minute], from: nextDate)
                                store.updateDailyReviewNotifications(
                                    hour: components.hour ?? defaultDailyReminderHour,
                                    minute: components.minute ?? defaultDailyReminderMinute
                                )
                            }
                        ),
                        displayedComponents: [.hourAndMinute]
                    )
                }
            } else {
                Section("Inactivity Reminder") {
                    Text("Example: between the selected local times, remind me after I have been away from the app for the chosen interval, keep reminding me every chosen interval inside that window, and repeat that pattern on later days until I come back.")
                        .foregroundStyle(.secondary)

                    DatePicker(
                        "From",
                        selection: Binding(
                            get: {
                                makeTimeOnlyDate(
                                    hour: store.reviewNotificationsSettings.inactivity.windowStartHour,
                                    minute: store.reviewNotificationsSettings.inactivity.windowStartMinute
                                )
                            },
                            set: { nextDate in
                                let components = Calendar.autoupdatingCurrent.dateComponents([.hour, .minute], from: nextDate)
                                store.updateInactivityReviewNotifications(
                                    windowStartHour: components.hour ?? defaultDailyReminderHour,
                                    windowStartMinute: components.minute ?? defaultDailyReminderMinute,
                                    windowEndHour: store.reviewNotificationsSettings.inactivity.windowEndHour,
                                    windowEndMinute: store.reviewNotificationsSettings.inactivity.windowEndMinute,
                                    idleMinutes: store.reviewNotificationsSettings.inactivity.idleMinutes
                                )
                            }
                        ),
                        displayedComponents: [.hourAndMinute]
                    )

                    DatePicker(
                        "To",
                        selection: Binding(
                            get: {
                                makeTimeOnlyDate(
                                    hour: store.reviewNotificationsSettings.inactivity.windowEndHour,
                                    minute: store.reviewNotificationsSettings.inactivity.windowEndMinute
                                )
                            },
                            set: { nextDate in
                                let components = Calendar.autoupdatingCurrent.dateComponents([.hour, .minute], from: nextDate)
                                store.updateInactivityReviewNotifications(
                                    windowStartHour: store.reviewNotificationsSettings.inactivity.windowStartHour,
                                    windowStartMinute: store.reviewNotificationsSettings.inactivity.windowStartMinute,
                                    windowEndHour: components.hour ?? defaultInactivityReminderWindowEndHour,
                                    windowEndMinute: components.minute ?? defaultInactivityReminderWindowEndMinute,
                                    idleMinutes: store.reviewNotificationsSettings.inactivity.idleMinutes
                                )
                            }
                        ),
                        displayedComponents: [.hourAndMinute]
                    )

                    Picker(
                        "Remind me after",
                        selection: Binding(
                            get: {
                                store.reviewNotificationsSettings.inactivity.idleMinutes
                            },
                            set: { idleMinutes in
                                store.updateInactivityReviewNotifications(
                                    windowStartHour: store.reviewNotificationsSettings.inactivity.windowStartHour,
                                    windowStartMinute: store.reviewNotificationsSettings.inactivity.windowStartMinute,
                                    windowEndHour: store.reviewNotificationsSettings.inactivity.windowEndHour,
                                    windowEndMinute: store.reviewNotificationsSettings.inactivity.windowEndMinute,
                                    idleMinutes: idleMinutes
                                )
                            }
                        )
                    ) {
                        ForEach([30, 60, 90, 120, 180, 240], id: \.self) { minutes in
                            Text(formatIdleMinutes(minutes: minutes)).tag(minutes)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Notifications")
        .task(id: store.workspace?.workspaceId) {
            await self.refreshPermissionStatus()
        }
    }

    private func refreshPermissionStatus() async {
        self.permissionStatus = await resolveReviewNotificationPermissionStatus()
    }

    private func handlePermissionAction() {
        switch self.permissionStatus {
        case .allowed, .blocked:
            openApplicationSettings()
        case .notRequested:
            Task { @MainActor in
                self.permissionStatus = await store.requestReviewNotificationPermissionFromSettings(
                    now: Date(),
                    autoEnableDefaultIfAllowed: false
                )
                self.permissionErrorMessage = ""
            }
        }
    }
}

private func makeTimeOnlyDate(hour: Int, minute: Int) -> Date {
    let calendar = Calendar.autoupdatingCurrent
    let now = Date()
    return calendar.date(
        bySettingHour: hour,
        minute: minute,
        second: 0,
        of: now
    ) ?? now
}

private func formatIdleMinutes(minutes: Int) -> String {
    if minutes % 60 == 0 {
        let hours = minutes / 60
        return hours == 1 ? "1 hour" : "\(hours) hours"
    }

    return "\(minutes) minutes"
}

#Preview {
    NavigationStack {
        ReviewNotificationsSettingsView()
            .environment(FlashcardsStore())
    }
}
