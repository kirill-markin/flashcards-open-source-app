package com.flashcardsopensourceapp.feature.settings.ai

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Card
import androidx.compose.material3.ListItem
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.settingsAiChatSuggestionsToggleTag
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding

@Composable
fun AiChatSuggestionsRoute(
    aiChatComposerSuggestionsEnabled: Boolean,
    onUpdateAiChatComposerSuggestionsEnabled: (Boolean) -> Unit,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = stringResource(R.string.settings_ai_chat_suggestions_title),
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
                            Text(stringResource(R.string.settings_ai_chat_suggestions_toggle_title))
                        },
                        supportingContent = {
                            Text(stringResource(R.string.settings_ai_chat_suggestions_toggle_body))
                        },
                        trailingContent = {
                            Switch(
                                checked = aiChatComposerSuggestionsEnabled,
                                onCheckedChange = onUpdateAiChatComposerSuggestionsEnabled,
                                modifier = Modifier.testTag(tag = settingsAiChatSuggestionsToggleTag)
                            )
                        }
                    )
                }
            }
        }
    }
}
