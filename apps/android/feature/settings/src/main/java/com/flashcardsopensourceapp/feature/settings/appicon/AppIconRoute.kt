package com.flashcardsopensourceapp.feature.settings.appicon

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.Card
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import com.flashcardsopensourceapp.data.local.appicon.AppIcon
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.settingsAppIconScreenTag
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding

@StringRes
private fun appIconLabel(appIcon: AppIcon): Int {
    return when (appIcon) {
        AppIcon.DEFAULT -> R.string.settings_app_icon_default
        AppIcon.LIGHT -> R.string.settings_app_icon_light
    }
}

@Composable
fun AppIconRoute(
    selectedAppIcon: AppIcon,
    isPremiumRequired: Boolean,
    onSelectAppIcon: (AppIcon) -> Unit,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = stringResource(R.string.settings_app_icon_title),
        onBack = onBack,
        isBackEnabled = true
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier
                .fillMaxSize()
                .selectableGroup()
                .testTag(tag = settingsAppIconScreenTag)
        ) {
            if (isPremiumRequired) {
                item {
                    Text(
                        text = stringResource(R.string.settings_app_icon_premium_note),
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }
            items(items = AppIcon.entries, key = { appIcon -> appIcon.storageValue }) { appIcon ->
                val selected: Boolean = selectedAppIcon == appIcon
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag(tag = "settings_app_icon_option_" + appIcon.storageValue)
                        .selectable(
                            selected = selected,
                            role = Role.RadioButton,
                            onClick = { onSelectAppIcon(appIcon) }
                        )
                ) {
                    ListItem(
                        headlineContent = { Text(stringResource(appIconLabel(appIcon = appIcon))) },
                        trailingContent = {
                            RadioButton(selected = selected, onClick = null)
                        }
                    )
                }
            }
            item {
                Text(
                    text = stringResource(R.string.settings_app_icon_launcher_note),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}
