package com.flashcardsopensourceapp.feature.settings

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

@Composable
fun AccessRoute(
    onOpenCapability: (AccessCapability) -> Unit,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val activity = context as? ComponentActivity
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
            title = accessCapabilityTitle(capability = capability),
            summary = accessCapabilitySummary(capability = capability),
            status = status,
            guidance = accessCapabilityGuidance(capability = capability, status = status),
            primaryActionLabel = accessCapabilityPrimaryActionLabel(status = status)
        )
    }

    SettingsScreenScaffold(
        title = "Access",
        onBack = onBack,
        isBackEnabled = true
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
            items(capabilityStates, key = { item -> item.capability.name }) { item ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text(item.title)
                        },
                        supportingContent = {
                            Text(item.status.name.lowercase().replaceFirstChar(Char::uppercase))
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
