package com.flashcardsopensourceapp.feature.settings.privacy

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Card
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.settingsProductAnalyticsToggleTag
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding

const val productAnalyticsScreenTag: String = "product_analytics_screen"

/**
 * Reachable with no cloud account, because an install that never signed in still reports product
 * analytics. The switch answers immediately from the stored local answer and never waits on a
 * server round trip.
 */
@Composable
fun ProductAnalyticsRoute(
    productAnalyticsEnabled: Boolean,
    onUpdateProductAnalyticsEnabled: (Boolean) -> Unit,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = stringResource(R.string.settings_product_analytics_title),
        onBack = onBack,
        isBackEnabled = true
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier
                .fillMaxSize()
                .testTag(tag = productAnalyticsScreenTag)
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text(stringResource(R.string.settings_product_analytics_toggle_title))
                        },
                        supportingContent = {
                            Text(stringResource(R.string.settings_product_analytics_toggle_body))
                        },
                        trailingContent = {
                            Switch(
                                checked = productAnalyticsEnabled,
                                onCheckedChange = onUpdateProductAnalyticsEnabled,
                                modifier = Modifier.testTag(tag = settingsProductAnalyticsToggleTag)
                            )
                        }
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = stringResource(R.string.settings_product_analytics_retention_body),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(20.dp)
                    )
                }
            }
        }
    }
}
