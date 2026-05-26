package com.flashcardsopensourceapp.feature.settings.account

import android.content.Context
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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

private data class ReviewAnimationSourceLink(
    @StringRes val urlResourceId: Int,
    @StringRes val titleResourceId: Int,
    @StringRes val summaryResourceId: Int
)

private val reviewAnimationSourceLinks: List<ReviewAnimationSourceLink> = listOf(
    ReviewAnimationSourceLink(R.string.review_rain_cloud_animation_url, R.string.settings_open_source_third_party_rain_cloud_source_title, R.string.settings_open_source_third_party_rain_cloud_source_summary),
    ReviewAnimationSourceLink(R.string.review_tornado_animation_url, R.string.settings_open_source_third_party_tornado_source_title, R.string.settings_open_source_third_party_tornado_source_summary),
    ReviewAnimationSourceLink(R.string.review_wind_face_animation_url, R.string.settings_open_source_third_party_wind_face_source_title, R.string.settings_open_source_third_party_wind_face_source_summary),
    ReviewAnimationSourceLink(R.string.review_snowflake_animation_url, R.string.settings_open_source_third_party_snowflake_source_title, R.string.settings_open_source_third_party_snowflake_source_summary),
    ReviewAnimationSourceLink(R.string.review_snail_animation_url, R.string.settings_open_source_third_party_snail_source_title, R.string.settings_open_source_third_party_snail_source_summary),
    ReviewAnimationSourceLink(R.string.review_turtle_animation_url, R.string.settings_open_source_third_party_turtle_source_title, R.string.settings_open_source_third_party_turtle_source_summary),
    ReviewAnimationSourceLink(R.string.review_wilted_flower_animation_url, R.string.settings_open_source_third_party_wilted_flower_source_title, R.string.settings_open_source_third_party_wilted_flower_source_summary),
    ReviewAnimationSourceLink(R.string.review_spider_animation_url, R.string.settings_open_source_third_party_spider_source_title, R.string.settings_open_source_third_party_spider_source_summary),
    ReviewAnimationSourceLink(R.string.review_rat_animation_url, R.string.settings_open_source_third_party_rat_source_title, R.string.settings_open_source_third_party_rat_source_summary),
    ReviewAnimationSourceLink(R.string.review_worm_animation_url, R.string.settings_open_source_third_party_worm_source_title, R.string.settings_open_source_third_party_worm_source_summary),
    ReviewAnimationSourceLink(R.string.review_tiger_animation_url, R.string.settings_open_source_third_party_tiger_source_title, R.string.settings_open_source_third_party_tiger_source_summary),
    ReviewAnimationSourceLink(R.string.review_t_rex_animation_url, R.string.settings_open_source_third_party_t_rex_source_title, R.string.settings_open_source_third_party_t_rex_source_summary),
    ReviewAnimationSourceLink(R.string.review_shark_animation_url, R.string.settings_open_source_third_party_shark_source_title, R.string.settings_open_source_third_party_shark_source_summary),
    ReviewAnimationSourceLink(R.string.review_ox_animation_url, R.string.settings_open_source_third_party_ox_source_title, R.string.settings_open_source_third_party_ox_source_summary),
    ReviewAnimationSourceLink(R.string.review_racehorse_animation_url, R.string.settings_open_source_third_party_racehorse_source_title, R.string.settings_open_source_third_party_racehorse_source_summary),
    ReviewAnimationSourceLink(R.string.review_snake_animation_url, R.string.settings_open_source_third_party_snake_source_title, R.string.settings_open_source_third_party_snake_source_summary),
    ReviewAnimationSourceLink(R.string.review_volcano_animation_url, R.string.settings_open_source_third_party_volcano_source_title, R.string.settings_open_source_third_party_volcano_source_summary),
    ReviewAnimationSourceLink(R.string.review_scorpion_animation_url, R.string.settings_open_source_third_party_scorpion_source_title, R.string.settings_open_source_third_party_scorpion_source_summary),
    ReviewAnimationSourceLink(R.string.review_paw_prints_animation_url, R.string.settings_open_source_third_party_paw_prints_source_title, R.string.settings_open_source_third_party_paw_prints_source_summary),
    ReviewAnimationSourceLink(R.string.review_rooster_animation_url, R.string.settings_open_source_third_party_rooster_source_title, R.string.settings_open_source_third_party_rooster_source_summary),
    ReviewAnimationSourceLink(R.string.review_otter_animation_url, R.string.settings_open_source_third_party_otter_source_title, R.string.settings_open_source_third_party_otter_source_summary),
    ReviewAnimationSourceLink(R.string.review_owl_animation_url, R.string.settings_open_source_third_party_owl_source_title, R.string.settings_open_source_third_party_owl_source_summary),
    ReviewAnimationSourceLink(R.string.review_rabbit_animation_url, R.string.settings_open_source_third_party_rabbit_source_title, R.string.settings_open_source_third_party_rabbit_source_summary),
    ReviewAnimationSourceLink(R.string.review_seal_animation_url, R.string.settings_open_source_third_party_seal_source_title, R.string.settings_open_source_third_party_seal_source_summary),
    ReviewAnimationSourceLink(R.string.review_service_dog_animation_url, R.string.settings_open_source_third_party_service_dog_source_title, R.string.settings_open_source_third_party_service_dog_source_summary),
    ReviewAnimationSourceLink(R.string.review_poodle_animation_url, R.string.settings_open_source_third_party_poodle_source_title, R.string.settings_open_source_third_party_poodle_source_summary),
    ReviewAnimationSourceLink(R.string.review_chimpanzee_animation_url, R.string.settings_open_source_third_party_chimpanzee_source_title, R.string.settings_open_source_third_party_chimpanzee_source_summary),
    ReviewAnimationSourceLink(R.string.review_whale_animation_url, R.string.settings_open_source_third_party_whale_source_title, R.string.settings_open_source_third_party_whale_source_summary),
    ReviewAnimationSourceLink(R.string.review_peacock_animation_url, R.string.settings_open_source_third_party_peacock_source_title, R.string.settings_open_source_third_party_peacock_source_summary),
    ReviewAnimationSourceLink(R.string.review_pig_animation_url, R.string.settings_open_source_third_party_pig_source_title, R.string.settings_open_source_third_party_pig_source_summary),
    ReviewAnimationSourceLink(R.string.review_sunrise_animation_url, R.string.settings_open_source_third_party_sunrise_source_title, R.string.settings_open_source_third_party_sunrise_source_summary),
    ReviewAnimationSourceLink(R.string.review_sunrise_over_mountains_animation_url, R.string.settings_open_source_third_party_sunrise_over_mountains_source_title, R.string.settings_open_source_third_party_sunrise_over_mountains_source_summary),
    ReviewAnimationSourceLink(R.string.review_rose_animation_url, R.string.settings_open_source_third_party_rose_source_title, R.string.settings_open_source_third_party_rose_source_summary),
    ReviewAnimationSourceLink(R.string.review_peace_animation_url, R.string.settings_open_source_third_party_peace_source_title, R.string.settings_open_source_third_party_peace_source_summary),
    ReviewAnimationSourceLink(R.string.review_plant_animation_url, R.string.settings_open_source_third_party_plant_source_title, R.string.settings_open_source_third_party_plant_source_summary),
    ReviewAnimationSourceLink(R.string.review_rainbow_animation_url, R.string.settings_open_source_third_party_rainbow_source_title, R.string.settings_open_source_third_party_rainbow_source_summary),
    ReviewAnimationSourceLink(R.string.review_phoenix_animation_url, R.string.settings_open_source_third_party_phoenix_source_title, R.string.settings_open_source_third_party_phoenix_source_summary),
    ReviewAnimationSourceLink(R.string.review_unicorn_animation_url, R.string.settings_open_source_third_party_unicorn_source_title, R.string.settings_open_source_third_party_unicorn_source_summary)
)

@Composable
fun AccountOpenSourceRoute(onBack: () -> Unit) {
    val context: Context = LocalContext.current
    val repositoryUrl: String = stringResource(id = R.string.flashcards_repository_url)
    val thirdPartyNoticesUrl: String = stringResource(id = R.string.third_party_notices_url)
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

            items(
                items = reviewAnimationSourceLinks,
                key = { link: ReviewAnimationSourceLink -> link.urlResourceId }
            ) { link: ReviewAnimationSourceLink ->
                val assetUrl: String = stringResource(id = link.urlResourceId)
                Card(modifier = Modifier.fillMaxWidth()) {
                    SettingsLinkItem(
                        title = stringResource(id = link.titleResourceId),
                        summary = stringResource(id = link.summaryResourceId),
                        icon = Icons.Outlined.Info,
                        onClick = {
                            openExternalUrl(context = context, url = assetUrl)
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
