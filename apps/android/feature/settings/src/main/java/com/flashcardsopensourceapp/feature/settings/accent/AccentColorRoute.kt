package com.flashcardsopensourceapp.feature.settings.accent

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.sync.defaultAccentColor
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding
import java.util.Locale
import kotlin.math.roundToInt

private data class AccentPreset(val color: String, @param:StringRes val label: Int)

private val accentPresets: List<AccentPreset> = listOf(
    AccentPreset(defaultAccentColor, R.string.settings_accent_default),
    AccentPreset("#4D8DFF", R.string.settings_accent_blue),
    AccentPreset("#A78BFA", R.string.settings_accent_purple),
    AccentPreset("#F472B6", R.string.settings_accent_pink),
    AccentPreset("#2DD4BF", R.string.settings_accent_teal),
    AccentPreset("#EAB308", R.string.settings_accent_gold)
)

@Composable
fun AccentColorRoute(
    uiState: AccentColorUiState,
    isPremiumRequired: Boolean,
    onSelectColor: (String) -> Unit,
    onBack: () -> Unit
) {
    var isCustomDialogVisible by rememberSaveable { mutableStateOf(false) }
    val isEnabled = uiState.canManagePreferences && uiState.isSaving.not()
    SettingsScreenScaffold(
        title = stringResource(R.string.settings_accent_title),
        onBack = onBack,
        isBackEnabled = true
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize().selectableGroup().testTag("settings.accent.screen")
        ) {
            item {
                Text(stringResource(R.string.settings_accent_selected, uiState.selectedColor))
            }
            if (isPremiumRequired) {
                item {
                    Text(
                        text = stringResource(R.string.settings_accent_premium_note),
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }
            if (uiState.isSaving) {
                item {
                    LinearProgressIndicator(
                        modifier = Modifier.fillMaxWidth().testTag("settings.accent.saving")
                    )
                }
            }
            items(items = accentPresets, key = { preset -> preset.color }) { preset ->
                val selected = uiState.selectedColor == preset.color
                Card(
                    modifier = Modifier.fillMaxWidth()
                        .testTag("settings.accent.preset." + preset.color.drop(1))
                        .selectable(
                            selected = selected,
                            enabled = isEnabled,
                            role = Role.RadioButton,
                            onClick = { onSelectColor(preset.color) }
                        )
                ) {
                    ListItem(
                        headlineContent = { Text(stringResource(preset.label)) },
                        supportingContent = { Text(preset.color) },
                        leadingContent = { AccentSwatch(color = preset.color) },
                        trailingContent = {
                            RadioButton(selected = selected, onClick = null, enabled = isEnabled)
                        }
                    )
                }
            }
            item {
                OutlinedButton(
                    onClick = { isCustomDialogVisible = true },
                    enabled = isEnabled,
                    modifier = Modifier.fillMaxWidth().testTag("settings.accent.custom")
                ) {
                    Text(stringResource(R.string.settings_accent_custom))
                }
            }
        }
    }
    if (isCustomDialogVisible) {
        CustomAccentColorDialog(
            initialColor = uiState.selectedColor,
            onConfirm = { color ->
                isCustomDialogVisible = false
                onSelectColor(color)
            },
            onDismiss = { isCustomDialogVisible = false }
        )
    }
}

@Composable
private fun AccentSwatch(color: String) {
    Box(
        modifier = Modifier.size(32.dp)
            .background(Color(android.graphics.Color.parseColor(color)), CircleShape)
    )
}

@Composable
private fun CustomAccentColorDialog(
    initialColor: String,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit
) {
    var hex by rememberSaveable { mutableStateOf(initialColor) }
    var previewColor by rememberSaveable { mutableStateOf(initialColor) }
    val isValid = Regex("^#[0-9A-Fa-f]{6}$").matches(hex)
    val rgb = previewColor.drop(1).toInt(radix = 16)
    val channels = listOf(
        Triple(R.string.settings_accent_red, 16, "red"),
        Triple(R.string.settings_accent_green, 8, "green"),
        Triple(R.string.settings_accent_blue_channel, 0, "blue")
    )
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.settings_accent_custom)) },
        text = {
            Column(
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.verticalScroll(rememberScrollState())
                    .testTag("settings.accent.customDialog")
            ) {
                AccentSwatch(color = previewColor)
                OutlinedTextField(
                    value = hex,
                    onValueChange = { value ->
                        hex = value
                        if (Regex("^#[0-9A-Fa-f]{6}$").matches(value)) {
                            previewColor = value.uppercase(Locale.ROOT)
                        }
                    },
                    label = { Text(stringResource(R.string.settings_accent_hex)) },
                    supportingText = {
                        Text(stringResource(R.string.settings_accent_hex_format))
                    },
                    isError = isValid.not(),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().testTag("settings.accent.hex")
                )
                channels.forEach { (label, shift, tag) ->
                    val channel = (rgb shr shift) and 255
                    val channelLabel = stringResource(label)
                    Text(stringResource(R.string.settings_accent_channel_value, channelLabel, channel))
                    Slider(
                        value = channel.toFloat(),
                        onValueChange = { value ->
                            val updatedRgb = (rgb and (255 shl shift).inv()) or
                                (value.roundToInt() shl shift)
                            val updatedHex = String.format(Locale.ROOT, "#%06X", updatedRgb)
                            hex = updatedHex
                            previewColor = updatedHex
                        },
                        valueRange = 0f..255f,
                        steps = 254,
                        modifier = Modifier.testTag("settings.accent." + tag)
                            .semantics { contentDescription = channelLabel }
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(hex.uppercase(Locale.ROOT)) },
                enabled = isValid,
                modifier = Modifier.testTag("settings.accent.confirm")
            ) {
                Text(stringResource(R.string.settings_accent_apply))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, modifier = Modifier.testTag("settings.accent.cancel")) {
                Text(stringResource(R.string.settings_accent_cancel))
            }
        }
    )
}
