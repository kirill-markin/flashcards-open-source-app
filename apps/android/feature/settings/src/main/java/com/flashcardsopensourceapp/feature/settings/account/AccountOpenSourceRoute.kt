package com.flashcardsopensourceapp.feature.settings.account

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.Card
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsLinkItem
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.openExternalUrl
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding

@Composable
fun AccountOpenSourceRoute(onBack: () -> Unit) {
    val context: Context = LocalContext.current
    val repositoryUrl: String = stringResource(id = R.string.flashcards_repository_url)
    val thirdPartyNoticesUrl: String = stringResource(id = R.string.third_party_notices_url)
    val reviewOwlAnimationUrl: String = stringResource(id = R.string.review_owl_animation_url)
    val reviewPoodleAnimationUrl: String = stringResource(id = R.string.review_poodle_animation_url)
    val reviewWhaleAnimationUrl: String = stringResource(id = R.string.review_whale_animation_url)
    val reviewPeacockAnimationUrl: String = stringResource(id = R.string.review_peacock_animation_url)
    val reviewSnailAnimationUrl: String = stringResource(id = R.string.review_snail_animation_url)
    val reviewRainbowAnimationUrl: String = stringResource(id = R.string.review_rainbow_animation_url)
    val reviewUnicornAnimationUrl: String = stringResource(id = R.string.review_unicorn_animation_url)
    val reviewWiltedFlowerAnimationUrl: String = stringResource(id = R.string.review_wilted_flower_animation_url)
    val reviewWormAnimationUrl: String = stringResource(id = R.string.review_worm_animation_url)
    val reviewTornadoAnimationUrl: String = stringResource(id = R.string.review_tornado_animation_url)
    val creativeCommonsAttributionUrl: String = stringResource(id = R.string.creative_commons_attribution_url)

    SettingsScreenScaffold(
        title = stringResource(R.string.settings_open_source_title),
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
                    SettingsLinkItem(
                        title = stringResource(R.string.settings_open_source_repository_title),
                        summary = stringResource(R.string.settings_open_source_repository_summary),
                        icon = Icons.Outlined.Code,
                        onClick = {
                            openExternalUrl(context = context, url = repositoryUrl)
                        }
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    SettingsLinkItem(
                        title = stringResource(R.string.settings_open_source_third_party_notices_title),
                        summary = stringResource(R.string.settings_open_source_third_party_notices_summary),
                        icon = Icons.Outlined.Info,
                        onClick = {
                            openExternalUrl(context = context, url = thirdPartyNoticesUrl)
                        }
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    SettingsLinkItem(
                        title = stringResource(R.string.settings_open_source_third_party_owl_source_title),
                        summary = stringResource(R.string.settings_open_source_third_party_owl_source_summary),
                        icon = Icons.Outlined.Info,
                        onClick = {
                            openExternalUrl(context = context, url = reviewOwlAnimationUrl)
                        }
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    SettingsLinkItem(
                        title = stringResource(R.string.settings_open_source_third_party_poodle_source_title),
                        summary = stringResource(R.string.settings_open_source_third_party_poodle_source_summary),
                        icon = Icons.Outlined.Info,
                        onClick = {
                            openExternalUrl(context = context, url = reviewPoodleAnimationUrl)
                        }
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    SettingsLinkItem(
                        title = stringResource(R.string.settings_open_source_third_party_whale_source_title),
                        summary = stringResource(R.string.settings_open_source_third_party_whale_source_summary),
                        icon = Icons.Outlined.Info,
                        onClick = {
                            openExternalUrl(context = context, url = reviewWhaleAnimationUrl)
                        }
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    SettingsLinkItem(
                        title = stringResource(R.string.settings_open_source_third_party_peacock_source_title),
                        summary = stringResource(R.string.settings_open_source_third_party_peacock_source_summary),
                        icon = Icons.Outlined.Info,
                        onClick = {
                            openExternalUrl(context = context, url = reviewPeacockAnimationUrl)
                        }
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    SettingsLinkItem(
                        title = stringResource(R.string.settings_open_source_third_party_unicorn_source_title),
                        summary = stringResource(R.string.settings_open_source_third_party_unicorn_source_summary),
                        icon = Icons.Outlined.Info,
                        onClick = {
                            openExternalUrl(context = context, url = reviewUnicornAnimationUrl)
                        }
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    SettingsLinkItem(
                        title = stringResource(R.string.settings_open_source_third_party_snail_source_title),
                        summary = stringResource(R.string.settings_open_source_third_party_snail_source_summary),
                        icon = Icons.Outlined.Info,
                        onClick = {
                            openExternalUrl(context = context, url = reviewSnailAnimationUrl)
                        }
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    SettingsLinkItem(
                        title = stringResource(R.string.settings_open_source_third_party_rainbow_source_title),
                        summary = stringResource(R.string.settings_open_source_third_party_rainbow_source_summary),
                        icon = Icons.Outlined.Info,
                        onClick = {
                            openExternalUrl(context = context, url = reviewRainbowAnimationUrl)
                        }
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    SettingsLinkItem(
                        title = stringResource(R.string.settings_open_source_third_party_worm_source_title),
                        summary = stringResource(R.string.settings_open_source_third_party_worm_source_summary),
                        icon = Icons.Outlined.Info,
                        onClick = {
                            openExternalUrl(context = context, url = reviewWormAnimationUrl)
                        }
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    SettingsLinkItem(
                        title = stringResource(R.string.settings_open_source_third_party_tornado_source_title),
                        summary = stringResource(R.string.settings_open_source_third_party_tornado_source_summary),
                        icon = Icons.Outlined.Info,
                        onClick = {
                            openExternalUrl(context = context, url = reviewTornadoAnimationUrl)
                        }
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    SettingsLinkItem(
                        title = stringResource(R.string.settings_open_source_third_party_wilted_flower_source_title),
                        summary = stringResource(R.string.settings_open_source_third_party_wilted_flower_source_summary),
                        icon = Icons.Outlined.Info,
                        onClick = {
                            openExternalUrl(context = context, url = reviewWiltedFlowerAnimationUrl)
                        }
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    SettingsLinkItem(
                        title = stringResource(R.string.settings_open_source_third_party_license_title),
                        summary = stringResource(R.string.settings_open_source_third_party_license_summary),
                        icon = Icons.Outlined.Info,
                        onClick = {
                            openExternalUrl(context = context, url = creativeCommonsAttributionUrl)
                        }
                    )
                }
            }
        }
    }
}
