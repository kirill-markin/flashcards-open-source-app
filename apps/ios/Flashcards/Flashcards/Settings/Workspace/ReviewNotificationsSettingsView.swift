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
                Text(
                    aiSettingsLocalized(
                        "settings.notifications.description",
                        "Notification settings stay attached to this workspace, but they apply only to the current device. Study reminders contain cards only and never marketing messages."
                    )
                )
                    .foregroundStyle(.secondary)
            }

            Section(aiSettingsLocalized("settings.notifications.section.permission", "Permission")) {
                LabeledContent(aiSettingsLocalized("settings.access.detail.status", "Status")) {
                    Text(localizedReviewNotificationPermissionStatusTitle(self.permissionStatus))
                }

                Button(localizedReviewNotificationPermissionActionTitle(self.permissionStatus)) {
                    self.handlePermissionAction()
                }
            }

            Section(aiSettingsLocalized("settings.notifications.section.reviewReminders", "Review Reminders")) {
                Toggle(
                    aiSettingsLocalized("settings.notifications.enableReminders", "Enable reminders"),
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
                    aiSettingsLocalized("settings.notifications.mode", "Mode"),
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
                        Text(localizedReviewNotificationModeTitle(mode)).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
            }

            if store.reviewNotificationsSettings.selectedMode == .daily {
                Section(aiSettingsLocalized("settings.notifications.section.dailyReminder", "Daily Reminder")) {
                    Text(aiSettingsLocalized("settings.notifications.dailyExample", "Example: send one card every day at the selected local time."))
                        .foregroundStyle(.secondary)

                    DatePicker(
                        aiSettingsLocalized("settings.notifications.time", "Time"),
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
                Section(aiSettingsLocalized("settings.notifications.section.inactivityReminder", "Inactivity Reminder")) {
                    Text(
                        aiSettingsLocalized(
                            "settings.notifications.inactivityExample",
                            "Example: between the selected local times, remind me after I have been away from the app for the chosen interval, keep reminding me every chosen interval inside that window, and repeat that pattern on later days until I come back."
                        )
                    )
                        .foregroundStyle(.secondary)

                    DatePicker(
                        aiSettingsLocalized("settings.notifications.from", "From"),
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
                        aiSettingsLocalized("settings.notifications.to", "To"),
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
                        aiSettingsLocalized("settings.notifications.remindAfter", "Remind me after"),
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
        .navigationTitle(aiSettingsLocalized("settings.notifications.title", "Notifications"))
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
        if hours == 1 {
            return aiSettingsLocalized("settings.notifications.duration.oneHour", "1 hour")
        }

        return aiSettingsLocalizedFormat("settings.notifications.duration.hours", "%d hours", hours)
    }

    return aiSettingsLocalizedFormat("settings.notifications.duration.minutes", "%d minutes", minutes)
}

#Preview {
    NavigationStack {
        ReviewNotificationsSettingsView()
            .environment(FlashcardsStore())
    }
}
