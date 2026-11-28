package com.flashcardsopensourceapp.feature.settings.theme

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.Card
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding
import com.flashcardsopensourceapp.feature.settings.settingsThemeOptionTag
import com.flashcardsopensourceapp.feature.settings.settingsThemeScreenTag

@StringRes
fun themeChoiceLabel(theme: ThemeChoice): Int {
    return when (theme) {
        ThemeChoice.DARK -> R.string.settings_theme_dark
        ThemeChoice.LIGHT -> R.string.settings_theme_light
        ThemeChoice.SYSTEM -> R.string.settings_theme_system
    }
}

@Composable
fun ThemeRoute(
    uiState: ThemeUiState,
    effectiveTheme: ThemeChoice,
    isPremiumRequired: Boolean,
    onSelectTheme: (ThemeChoice) -> Unit,
    onBack: () -> Unit
) {
    val isEnabled = uiState.canManagePreferences
    SettingsScreenScaffold(
        title = stringResource(R.string.settings_theme_title),
        onBack = onBack,
        isBackEnabled = true
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize().selectableGroup().testTag(settingsThemeScreenTag)
        ) {
            if (isPremiumRequired) {
                item {
                    Text(
                        text = stringResource(R.string.settings_theme_premium_note),
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }
            uiState.errorMessage?.let { message ->
                item {
                    Text(text = message, color = MaterialTheme.colorScheme.error)
                }
            }
            if (uiState.isSaving) {
                item {
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                }
            }
            items(items = ThemeChoice.entries, key = { theme -> theme.tagValue }) { theme ->
                val selected = effectiveTheme == theme
                Card(
                    modifier = Modifier.fillMaxWidth()
                        .testTag(settingsThemeOptionTag(theme = theme.tagValue))
                        .selectable(
                            selected = selected,
                            enabled = isEnabled,
                            role = Role.RadioButton,
                            onClick = { onSelectTheme(theme) }
                        )
                ) {
                    ListItem(
                        headlineContent = { Text(stringResource(themeChoiceLabel(theme = theme))) },
                        trailingContent = {
                            RadioButton(selected = selected, onClick = null, enabled = isEnabled)
                        }
                    )
                }
            }
        }
    }
}
