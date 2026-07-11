import SwiftUI

struct NotificationsSettingsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(\.scenePhase) private var scenePhase

    @State private var permissionStatus: ReviewNotificationPermissionStatus = .notRequested
    @State private var permissionErrorMessage: String = ""

    var body: some View {
        List {
            if self.permissionErrorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: self.permissionErrorMessage)
                }
            }

            Section(aiSettingsLocalized("settings.notifications.section.permission", "Permission")) {
                LabeledContent(aiSettingsLocalized("settings.access.detail.status", "Status")) {
                    Text(localizedReviewNotificationPermissionStatusTitle(self.permissionStatus))
                }

                Button(localizedReviewNotificationPermissionActionTitle(self.permissionStatus)) {
                    self.handlePermissionAction()
                }
            }

            if self.permissionStatus == .allowed {
                Section {
                    Toggle(
                        aiSettingsLocalized("settings.notifications.enableNotifications", "Enable notifications"),
                        isOn: Binding(
                            get: {
                                store.reviewNotificationsSettings.isEnabled
                            },
                            set: { isEnabled in
                                store.updateReviewNotificationsEnabled(isEnabled: isEnabled)
                            }
                        )
                    )
                }

                if store.reviewNotificationsSettings.isEnabled {
                    Section(aiSettingsLocalized("settings.notifications.mode", "Mode")) {
                        self.reviewNotificationModePicker
                    }

                    if store.reviewNotificationsSettings.selectedMode == .daily {
                        Section(aiSettingsLocalized("settings.notifications.section.dailyReminder", "Once daily")) {
                            Text(
                                aiSettingsLocalized(
                                    "settings.notifications.dailyExample",
                                    "Send one card once per day at the selected time."
                                )
                            )
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
                        Section(aiSettingsLocalized("settings.notifications.timeWindow", "Time window")) {
                            Text(
                                aiSettingsLocalized(
                                    "settings.notifications.inactivityExample",
                                    "The first reminder arrives after inactivity during this window. Later reminders repeat at the chosen interval."
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
                                aiSettingsLocalized("settings.notifications.repeatEvery", "Repeat every"),
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

                    Section(aiSettingsLocalized("settings.notifications.section.appIconBadge", "App Icon Badge")) {
                        self.appIconBadgeToggle
                    }

                    Section(aiSettingsLocalized("settings.notifications.section.strictReminders", "Streak reminders")) {
                        Toggle(
                            aiSettingsLocalized("settings.notifications.enableStrictReminders", "Enable streak reminders"),
                            isOn: Binding(
                                get: {
                                    store.strictRemindersSettings.isEnabled
                                },
                                set: { isEnabled in
                                    store.updateStrictRemindersEnabled(isEnabled: isEnabled)
                                }
                            )
                        )

                        Text(
                            aiSettingsLocalized(
                                "settings.notifications.strictReminders.description",
                                "If you have not reviewed in the current workspace today, Flashcards reminds you 4, 3, and 2 hours before midnight so you can keep your streak."
                            )
                        )
                            .foregroundStyle(.secondary)
                    }

                    Section {
                        Text(
                            aiSettingsLocalized(
                                "settings.notifications.description",
                                "Study reminders stay on this device and use cards and streak activity from the currently selected workspace."
                            )
                        )
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(aiSettingsLocalized("settings.notifications.title", "Notifications"))
        .task {
            await self.refreshPermissionStatus()
        }
        .onChange(of: self.scenePhase) { _, nextPhase in
            guard nextPhase == .active else {
                return
            }

            Task { @MainActor in
                await self.refreshPermissionStatus()
            }
        }
    }

    private var reviewNotificationModePicker: some View {
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

    private var appIconBadgeToggle: some View {
        Group {
            Toggle(
                aiSettingsLocalized("settings.notifications.appIconBadge.toggle", "Show app icon badge"),
                isOn: Binding(
                    get: {
                        store.reviewNotificationsSettings.showAppIconBadge
                    },
                    set: { isEnabled in
                        store.updateReviewNotificationsAppIconBadgeEnabled(isEnabled: isEnabled)
                    }
                )
            )

            Text(
                aiSettingsLocalized(
                    "settings.notifications.appIconBadge.description",
                    "Show a red 1 on the app icon when a reminder fires and you have not reviewed in the current workspace today. Opening the app clears delivered review reminders; the badge clears after you review or turn this off."
                )
            )
                .foregroundStyle(.secondary)
        }
    }

    @MainActor
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
                    now: Date()
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
        NotificationsSettingsView()
            .environment(FlashcardsStore())
    }
}
