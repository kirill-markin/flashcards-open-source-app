package com.flashcardsopensourceapp.feature.settings

import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccessDetailRoute(
    capability: AccessCapability,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val activity = context as? ComponentActivity
    val permission = accessCapabilityPermission(capability = capability)
    var permissionResultVersion by remember(capability) {
        mutableStateOf(value = 0)
    }
    val status = if (activity == null) {
        AccessStatus.UNAVAILABLE
    } else {
        permissionResultVersion
        resolveAccessStatus(
            activity = activity,
            capability = capability,
            hasRequestedPermission = hasRequestedAccessPermission(context = context, capability = capability)
        )
    }
    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) {
        permissionResultVersion += 1
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(accessCapabilityTitle(capability = capability))
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = "Back"
                        )
                    }
                }
            )
        }
    ) { innerPadding ->
        LazyColumn(
            contentPadding = PaddingValues(
                start = 16.dp,
                top = innerPadding.calculateTopPadding() + 16.dp,
                end = 16.dp,
                bottom = innerPadding.calculateBottomPadding() + 24.dp
            ),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                DeviceInfoCard(
                    title = accessCapabilityTitle(capability = capability),
                    rows = listOf(
                        "Status" to status.name.lowercase().replaceFirstChar(Char::uppercase),
                        "Usage" to accessCapabilitySummary(capability = capability)
                    )
                )
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = accessCapabilityGuidance(capability = capability, status = status),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(20.dp)
                    )
                }
            }

            val primaryActionLabel = accessCapabilityPrimaryActionLabel(status = status)
            if (primaryActionLabel != null) {
                item {
                    Button(
                        onClick = {
                            when (status) {
                                AccessStatus.ASK_EVERY_TIME -> {
                                    requireNotNull(permission) {
                                        "Android permission is required for this capability."
                                    }
                                    markAccessPermissionRequested(context = context, capability = capability)
                                    launcher.launch(permission)
                                }

                                AccessStatus.ALLOWED,
                                AccessStatus.BLOCKED -> {
                                    openApplicationSettings(context = context)
                                }

                                AccessStatus.SYSTEM_PICKER,
                                AccessStatus.UNAVAILABLE -> Unit
                            }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(primaryActionLabel)
                    }
                }
            }
        }
    }
}
