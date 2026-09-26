package com.flashcardsopensourceapp.feature.settings.subscription

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding

const val subscriptionScreenTag: String = "subscription_screen"
const val subscriptionPremiumPreviewTag: String = "subscription_premium_preview"
const val subscriptionManageButtonTag: String = "subscription_manage_button"

@Composable
fun SubscriptionRoute(
    uiState: SubscriptionUiState,
    onManageSubscription: () -> Unit,
    onPreviewPremium: () -> Unit,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = stringResource(R.string.settings_subscription_title),
        onBack = onBack,
        isBackEnabled = true
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier
                .fillMaxSize()
                .testTag(tag = subscriptionScreenTag)
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        overlineContent = {
                            Text(stringResource(R.string.settings_subscription_current_plan_label))
                        },
                        headlineContent = {
                            Text(uiState.planName ?: stringResource(R.string.settings_subscription_plan_unknown))
                        },
                        supportingContent = {
                            Text(uiState.statusText)
                        }
                    )
                }
            }

            item {
                Button(
                    onClick = onPreviewPremium,
                    modifier = Modifier.fillMaxWidth().testTag(tag = subscriptionPremiumPreviewTag)
                ) {
                    Text(stringResource(R.string.settings_premium_preview))
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.padding(20.dp)
                    ) {
                        Text(
                            text = stringResource(R.string.settings_subscription_manage_body),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodyMedium
                        )
                        Button(
                            onClick = onManageSubscription,
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag(tag = subscriptionManageButtonTag)
                        ) {
                            Text(stringResource(R.string.settings_subscription_manage_button))
                        }
                    }
                }
            }
        }
    }
}
