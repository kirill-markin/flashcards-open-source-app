package com.flashcardsopensourceapp.feature.settings

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
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
import androidx.core.content.ContextCompat
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationMode

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
        title = "Notifications",
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
                            Text("This device only")
                        },
                        supportingContent = {
                            Text("Notification settings stay attached to this workspace, but they apply only to the current device. Study reminders contain cards only and never marketing messages.")
                        }
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text("Permission")
                        },
                        supportingContent = {
                            Text(
                                when (permissionStatus) {
                                    ReviewNotificationPermissionUiStatus.ALLOWED -> "Allowed"
                                    ReviewNotificationPermissionUiStatus.NOT_REQUESTED -> "Not requested"
                                    ReviewNotificationPermissionUiStatus.BLOCKED -> "Blocked"
                                }
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
                                        ReviewNotificationPermissionUiStatus.BLOCKED -> "Open app settings"
                                        ReviewNotificationPermissionUiStatus.NOT_REQUESTED -> "Allow notifications"
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
                            Text("Review reminders")
                        },
                        supportingContent = {
                            Text("Send study cards from the current review filter on this device.")
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
                                            "Daily"
                                        } else {
                                            "Inactivity"
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
                                Text("Daily reminder")
                            },
                            supportingContent = {
                                Text("Example: send one card every day at ${formatTimeLabel(hour = uiState.settings.daily.hour, minute = uiState.settings.daily.minute)}.")
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
                                Text("Inactivity reminder")
                            },
                            supportingContent = {
                                Text("Example: between ${formatTimeLabel(hour = uiState.settings.inactivity.windowStartHour, minute = uiState.settings.inactivity.windowStartMinute)} and ${formatTimeLabel(hour = uiState.settings.inactivity.windowEndHour, minute = uiState.settings.inactivity.windowEndMinute)}, remind me after ${formatIdleMinutes(minutes = uiState.settings.inactivity.idleMinutes)} away from the app, and keep reminding me on later days inside that window until I return.")
                            }
                        )
                    }
                }

                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        ListItem(
                            headlineContent = {
                                Text("From")
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
                                Text("To")
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
                                Text("Remind me after")
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
                                                Text(formatIdleMinutes(minutes = value))
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
private fun TimeValueStepper(
    hour: Int,
    minute: Int,
    onValueChange: (Int, Int) -> Unit
) {
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
            text = formatTimeLabel(hour = hour, minute = minute),
            color = MaterialTheme.colorScheme.primary
        )
    }
}

private fun formatTimeLabel(hour: Int, minute: Int): String {
    return "%02d:%02d".format(hour, minute)
}

private fun formatIdleMinutes(minutes: Int): String {
    return if (minutes % 60 == 0) {
        val hours = minutes / 60
        if (hours == 1) {
            "1h"
        } else {
            "${hours}h"
        }
    } else {
        "${minutes}m"
    }
}

private fun hasNotificationPermission(context: Context): Boolean {
    return ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.POST_NOTIFICATIONS
    ) == PackageManager.PERMISSION_GRANTED
}
