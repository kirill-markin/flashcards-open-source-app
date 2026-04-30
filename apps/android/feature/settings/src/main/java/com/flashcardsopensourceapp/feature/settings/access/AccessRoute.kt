package com.flashcardsopensourceapp.feature.settings.access

import androidx.activity.ComponentActivity
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding

@Composable
fun AccessRoute(
    onOpenNotifications: () -> Unit,
    onOpenCapability: (AccessCapability) -> Unit,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val activity = context as? ComponentActivity
    val strings = createSettingsStringResolver(context = context)
    val capabilityStates = AccessCapability.entries.map { capability ->
        val status = if (activity == null) {
            AccessStatus.UNAVAILABLE
        } else {
            resolveAccessStatus(
                activity = activity,
                capability = capability,
                hasRequestedPermission = hasRequestedAccessPermission(context = context, capability = capability)
            )
        }
        AccessCapabilityUiState(
            capability = capability,
            title = accessCapabilityTitle(capability = capability, strings = strings),
            summary = accessCapabilitySummary(capability = capability, strings = strings),
            status = status,
            guidance = accessCapabilityGuidance(
                capability = capability,
                status = status,
                strings = strings
            ),
            primaryActionLabel = accessCapabilityPrimaryActionLabel(status = status, strings = strings)
        )
    }

    SettingsScreenScaffold(
        title = stringResource(R.string.settings_access_title),
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
                            Text(stringResource(R.string.settings_access_notifications_title))
                        },
                        supportingContent = {
                            Text(stringResource(R.string.settings_access_notifications_summary))
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.Info,
                                contentDescription = null
                            )
                        },
                        modifier = Modifier.clickable(onClick = onOpenNotifications)
                    )
                }
            }

            items(capabilityStates, key = { item -> item.capability.name }) { item ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text(item.title)
                        },
                        supportingContent = {
                            Text(
                                when (item.status) {
                                    AccessStatus.ALLOWED -> stringResource(R.string.settings_access_status_allowed)
                                    AccessStatus.ASK_EVERY_TIME -> stringResource(R.string.settings_access_status_ask_every_time)
                                    AccessStatus.BLOCKED -> stringResource(R.string.settings_access_status_blocked)
                                    AccessStatus.SYSTEM_PICKER -> stringResource(R.string.settings_access_status_system_picker)
                                    AccessStatus.UNAVAILABLE -> stringResource(R.string.settings_access_status_unavailable)
                                }
                            )
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.Info,
                                contentDescription = null
                            )
                        },
                        modifier = Modifier.clickable {
                            onOpenCapability(item.capability)
                        }
                    )
                }
            }
        }
    }
}
