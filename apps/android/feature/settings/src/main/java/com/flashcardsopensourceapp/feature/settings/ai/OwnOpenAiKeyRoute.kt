package com.flashcardsopensourceapp.feature.settings.ai

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Card
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.settingsOwnOpenAiKeyFieldTag
import com.flashcardsopensourceapp.feature.settings.settingsOwnOpenAiKeyMonthMessagesTag
import com.flashcardsopensourceapp.feature.settings.settingsOwnOpenAiKeyToggleTag
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding

@Composable
fun OwnOpenAiKeyRoute(
    uiState: OwnOpenAiKeyUiState,
    onUpdateEnabled: (Boolean) -> Unit,
    onUpdateApiKey: (String) -> Unit,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = stringResource(R.string.settings_own_openai_key_title),
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
                            Text(stringResource(R.string.settings_own_openai_key_toggle_title))
                        },
                        supportingContent = {
                            Text(stringResource(R.string.settings_own_openai_key_toggle_body))
                        },
                        trailingContent = {
                            Switch(
                                checked = uiState.isEnabled,
                                onCheckedChange = onUpdateEnabled,
                                modifier = Modifier.testTag(tag = settingsOwnOpenAiKeyToggleTag)
                            )
                        }
                    )
                }
            }

            if (uiState.isEnabled) {
                item {
                    // The field owns its text, because text that round-trips through the view model's
                    // flow arrives a frame late and drops keystrokes. It restarts from the stored key once
                    // the key is loaded and whenever the storage error appears or clears, because the store
                    // drops the key on that error. Plain remember keeps the key out of saved instance state.
                    var apiKeyDraft by remember(uiState.isApiKeyFieldEnabled, uiState.isStoredKeyUnreadable) {
                        mutableStateOf(value = uiState.apiKey)
                    }
                    OutlinedTextField(
                        value = apiKeyDraft,
                        onValueChange = { apiKey ->
                            apiKeyDraft = apiKey
                            onUpdateApiKey(apiKey)
                        },
                        label = {
                            Text(stringResource(R.string.settings_own_openai_key_field_label))
                        },
                        enabled = uiState.isApiKeyFieldEnabled,
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag(tag = settingsOwnOpenAiKeyFieldTag)
                    )
                }

                if (uiState.isStoredKeyUnreadable) {
                    item {
                        Text(
                            text = stringResource(R.string.settings_own_openai_key_storage_unreadable),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                }

                uiState.ownKeyMessages?.let { ownKeyMessages ->
                    item {
                        Text(
                            text = pluralStringResource(
                                id = R.plurals.settings_own_openai_key_month_messages,
                                count = ownKeyMessages,
                                ownKeyMessages
                            ),
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.testTag(tag = settingsOwnOpenAiKeyMonthMessagesTag)
                        )
                    }
                }

                if (uiState.usageErrorMessage.isNotEmpty()) {
                    item {
                        Text(
                            text = uiState.usageErrorMessage,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                }
            }
        }
    }
}
