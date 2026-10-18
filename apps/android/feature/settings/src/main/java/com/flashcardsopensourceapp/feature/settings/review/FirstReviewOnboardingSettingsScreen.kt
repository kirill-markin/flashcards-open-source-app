package com.flashcardsopensourceapp.feature.settings.review

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.settingsFirstReviewOnboardingScreenTag
import com.flashcardsopensourceapp.feature.settings.settingsFirstReviewOnboardingToggleTag
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding

@Composable
fun FirstReviewOnboardingSettingsScreen(
    completed: Boolean?,
    onCompletedChanged: (Boolean) -> Unit,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = stringResource(R.string.settings_first_review_onboarding_title),
        onBack = onBack,
        isBackEnabled = true
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize().testTag(settingsFirstReviewOnboardingScreenTag)
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = { Text(stringResource(R.string.settings_first_review_onboarding_completed)) },
                        supportingContent = { Text(stringResource(R.string.settings_first_review_onboarding_body)) },
                        trailingContent = {
                            if (completed == null) {
                                CircularProgressIndicator(modifier = Modifier.size(24.dp))
                            } else {
                                Switch(
                                    checked = completed,
                                    onCheckedChange = onCompletedChanged,
                                    modifier = Modifier.testTag(settingsFirstReviewOnboardingToggleTag)
                                )
                            }
                        }
                    )
                }
            }
        }
    }
}
