package com.flashcardsopensourceapp.feature.settings.review

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.text.format.DateFormat
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.core.content.ContextCompat
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationMode
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.access.openApplicationSettings
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReviewNotificationsRoute(
    uiState: ReviewNotificationsUiState,
    onUpdateEnabled: (Boolean) -> Unit,
    onUpdateMode: (ReviewNotificationMode) -> Unit,
    onUpdateDailyTime: (Int, Int) -> Unit,
    onUpdateInactivityWindowStart: (Int, Int) -> Unit,
    onUpdateInactivityWindowEnd: (Int, Int) -> Unit,
    onUpdateIdleMinutes: (Int) -> Unit,
    onUpdateShowAppIconBadge: (Boolean) -> Unit,
    onUpdateStrictRemindersEnabled: (Boolean) -> Unit,
    onMarkSystemPermissionRequested: () -> Unit,
    onPermissionGranted: () -> Unit,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val activity = context as? ComponentActivity
    val permissionStatus = when {
        activity == null -> ReviewNotificationPermissionUiStatus.BLOCKED
        hasNotificationPermission(context = context) -> ReviewNotificationPermissionUiStatus.ALLOWED
        uiState.hasRequestedSystemPermission -> ReviewNotificationPermissionUiStatus.BLOCKED
        else -> ReviewNotificationPermissionUiStatus.NOT_REQUESTED
    }
    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (isGranted) {
            onPermissionGranted()
        }
    }

    SettingsScreenScaffold(
        title = stringResource(R.string.settings_notifications_title),
        onBack = onBack,
        isBackEnabled = true
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text(stringResource(R.string.settings_notifications_this_device_title))
                        },
                        supportingContent = {
                            Text(stringResource(R.string.settings_notifications_this_device_body))
                        }
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text(stringResource(R.string.settings_notifications_permission_title))
                        },
                        supportingContent = {
                            Text(
                                buildNotificationPermissionBody(permissionStatus = permissionStatus)
                            )
                        },
                        trailingContent = {
                            TextButton(
                                onClick = {
                                    when (permissionStatus) {
                                        ReviewNotificationPermissionUiStatus.ALLOWED,
                                        ReviewNotificationPermissionUiStatus.BLOCKED -> openApplicationSettings(context = context)
                                        ReviewNotificationPermissionUiStatus.NOT_REQUESTED -> {
                                            onMarkSystemPermissionRequested()
                                            permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                                        }
                                    }
                                }
                            ) {
                                Text(
                                    when (permissionStatus) {
                                        ReviewNotificationPermissionUiStatus.ALLOWED,
                                        ReviewNotificationPermissionUiStatus.BLOCKED -> stringResource(R.string.settings_access_open_app_settings)
                                        ReviewNotificationPermissionUiStatus.NOT_REQUESTED -> stringResource(R.string.settings_notifications_allow_button)
                                    }
                                )
                            }
                        }
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text(stringResource(R.string.settings_notifications_strict_reminders_title))
                        },
                        supportingContent = {
                            Text(
                                stringResource(R.string.settings_notifications_strict_reminders_body) +
                                    "\n\n" +
                                    stringResource(R.string.settings_notifications_strict_reminders_device_note)
                            )
                        },
                        trailingContent = {
                            Switch(
                                checked = uiState.strictRemindersSettings.isEnabled,
                                onCheckedChange = onUpdateStrictRemindersEnabled
                            )
                        }
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text(stringResource(R.string.settings_notifications_reminders_title))
                        },
                        supportingContent = {
                            Text(stringResource(R.string.settings_notifications_reminders_body))
                        },
                        trailingContent = {
                            Switch(
                                checked = uiState.settings.isEnabled,
                                onCheckedChange = onUpdateEnabled
                            )
                        }
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text(stringResource(R.string.settings_notifications_show_app_icon_badge_title))
                        },
                        supportingContent = {
                            Text(stringResource(R.string.settings_notifications_show_app_icon_badge_body))
                        },
                        trailingContent = {
                            Switch(
                                checked = uiState.settings.showAppIconBadge,
                                onCheckedChange = onUpdateShowAppIconBadge
                            )
                        }
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                        val modes = listOf(ReviewNotificationMode.DAILY, ReviewNotificationMode.INACTIVITY)
                        modes.forEachIndexed { index, mode ->
                            SegmentedButton(
                                selected = uiState.settings.selectedMode == mode,
                                onClick = {
                                    onUpdateMode(mode)
                                },
                                shape = androidx.compose.material3.SegmentedButtonDefaults.itemShape(
                                    index = index,
                                    count = modes.size
                                ),
                                label = {
                                    Text(
                                        if (mode == ReviewNotificationMode.DAILY) {
                                            stringResource(R.string.settings_notifications_mode_daily)
                                        } else {
                                            stringResource(R.string.settings_notifications_mode_inactivity)
                                        }
                                    )
                                }
                            )
                        }
                    }
                }
            }

            if (uiState.settings.selectedMode == ReviewNotificationMode.DAILY) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        ListItem(
                            headlineContent = {
                                Text(stringResource(R.string.settings_notifications_daily_title))
                            },
                            supportingContent = {
                                Text(
                                    stringResource(
                                        R.string.settings_notifications_daily_example,
                                        formatTimeLabel(
                                            context = context,
                                            hour = uiState.settings.daily.hour,
                                            minute = uiState.settings.daily.minute
                                        )
                                    )
                                )
                            },
                            trailingContent = {
                                TimeValueStepper(
                                    hour = uiState.settings.daily.hour,
                                    minute = uiState.settings.daily.minute,
                                    onValueChange = onUpdateDailyTime
                                )
                            }
                        )
                    }
                }
            } else {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        ListItem(
                            headlineContent = {
                                Text(stringResource(R.string.settings_notifications_inactivity_title))
                            },
                            supportingContent = {
                                Text(
                                    stringResource(
                                        R.string.settings_notifications_inactivity_example,
                                        formatTimeLabel(
                                            context = context,
                                            hour = uiState.settings.inactivity.windowStartHour,
                                            minute = uiState.settings.inactivity.windowStartMinute
                                        ),
                                        formatTimeLabel(
                                            context = context,
                                            hour = uiState.settings.inactivity.windowEndHour,
                                            minute = uiState.settings.inactivity.windowEndMinute
                                        ),
                                        idleMinutesLabel(minutes = uiState.settings.inactivity.idleMinutes),
                                        idleMinutesLabel(minutes = uiState.settings.inactivity.idleMinutes)
                                    )
                                )
                            }
                        )
                    }
                }

                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        ListItem(
                            headlineContent = {
                                Text(stringResource(R.string.settings_notifications_from_title))
                            },
                            trailingContent = {
                                TimeValueStepper(
                                    hour = uiState.settings.inactivity.windowStartHour,
                                    minute = uiState.settings.inactivity.windowStartMinute,
                                    onValueChange = onUpdateInactivityWindowStart
                                )
                            }
                        )
                    }
                }

                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        ListItem(
                            headlineContent = {
                                Text(stringResource(R.string.settings_notifications_to_title))
                            },
                            trailingContent = {
                                TimeValueStepper(
                                    hour = uiState.settings.inactivity.windowEndHour,
                                    minute = uiState.settings.inactivity.windowEndMinute,
                                    onValueChange = onUpdateInactivityWindowEnd
                                )
                            }
                        )
                    }
                }

                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        ListItem(
                            headlineContent = {
                                Text(stringResource(R.string.settings_notifications_remind_after_title))
                            },
                            trailingContent = {
                                SingleChoiceSegmentedButtonRow {
                                    listOf(60, 120, 180).forEachIndexed { index, value ->
                                        SegmentedButton(
                                            selected = uiState.settings.inactivity.idleMinutes == value,
                                            onClick = {
                                                onUpdateIdleMinutes(value)
                                            },
                                            shape = androidx.compose.material3.SegmentedButtonDefaults.itemShape(
                                                index = index,
                                                count = 3
                                            ),
                                            label = {
                                                Text(idleMinutesLabel(minutes = value))
                                            }
                                        )
                                    }
                                }
                            }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun buildNotificationPermissionBody(
    permissionStatus: ReviewNotificationPermissionUiStatus
): String {
    val statusLabel = when (permissionStatus) {
        ReviewNotificationPermissionUiStatus.ALLOWED -> {
            stringResource(R.string.settings_access_status_allowed)
        }

        ReviewNotificationPermissionUiStatus.NOT_REQUESTED -> {
            stringResource(R.string.settings_access_status_not_requested)
        }

        ReviewNotificationPermissionUiStatus.BLOCKED -> {
            stringResource(R.string.settings_access_status_blocked)
        }
    }
    val guidance = when (permissionStatus) {
        ReviewNotificationPermissionUiStatus.ALLOWED -> {
            stringResource(R.string.settings_notifications_permission_guidance_allowed)
        }

        ReviewNotificationPermissionUiStatus.NOT_REQUESTED -> {
            stringResource(R.string.settings_notifications_permission_guidance_request)
        }

        ReviewNotificationPermissionUiStatus.BLOCKED -> {
            stringResource(R.string.settings_notifications_permission_guidance_blocked)
        }
    }

    return "$statusLabel\n\n$guidance"
}

@Composable
private fun TimeValueStepper(
    hour: Int,
    minute: Int,
    onValueChange: (Int, Int) -> Unit
) {
    val context = LocalContext.current
    TextButton(
        onClick = {
            val nextMinute = if (minute == 30) 0 else 30
            val nextHour = if (minute == 30) {
                (hour + 1) % 24
            } else {
                hour
            }
            onValueChange(nextHour, nextMinute)
        }
    ) {
        Text(
            text = formatTimeLabel(context = context, hour = hour, minute = minute),
            color = MaterialTheme.colorScheme.primary
        )
    }
}

private fun formatTimeLabel(
    context: Context,
    hour: Int,
    minute: Int
): String {
    val locale = context.resources.configuration.locales[0] ?: Locale.getDefault()
    val skeleton = if (DateFormat.is24HourFormat(context)) "Hm" else "hm"
    val pattern = DateFormat.getBestDateTimePattern(locale, skeleton)
    return LocalTime.of(hour, minute).format(DateTimeFormatter.ofPattern(pattern, locale))
}

@Composable
private fun idleMinutesLabel(minutes: Int): String {
    return formatIdleMinutes(
        minutes = minutes,
        oneMinuteLabel = pluralStringResource(
            R.plurals.settings_notifications_duration_minutes,
            minutes,
            minutes
        ),
        oneHourLabel = pluralStringResource(
            R.plurals.settings_notifications_duration_hours,
            minutes / 60,
            minutes / 60
        )
    )
}

private fun formatIdleMinutes(
    minutes: Int,
    oneMinuteLabel: String,
    oneHourLabel: String
): String {
    return if (minutes % 60 == 0) {
        oneHourLabel
    } else {
        oneMinuteLabel
    }
}

private fun hasNotificationPermission(context: Context): Boolean {
    return ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.POST_NOTIFICATIONS
    ) == PackageManager.PERMISSION_GRANTED
}
