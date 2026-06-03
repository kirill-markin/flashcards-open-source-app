package com.flashcardsopensourceapp.feature.review

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.core.ui.bidiWrap
import com.flashcardsopensourceapp.core.ui.currentResourceLocale
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.ReviewDeckFilterOption
import com.flashcardsopensourceapp.data.local.model.ReviewEffortFilterOption
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.ReviewTagFilterOption

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ReviewFilterSheet(
    selectedFilter: ReviewFilter,
    availableDeckFilters: List<ReviewDeckFilterOption>,
    availableEffortFilters: List<ReviewEffortFilterOption>,
    availableTagFilters: List<ReviewTagFilterOption>,
    onDismiss: () -> Unit,
    onSelectFilter: (ReviewFilter) -> Unit,
    onManageDecks: () -> Unit
) {
    val context = LocalContext.current
    val locale = currentResourceLocale(resources = context.resources)

    ModalBottomSheet(onDismissRequest = onDismiss) {
        LazyColumn(
            contentPadding = PaddingValues(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            item {
                Text(
                    text = stringResource(id = R.string.review_scope_title),
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.padding(horizontal = 24.dp)
                )
            }

            item {
                ReviewFilterOptionRow(
                    title = stringResource(id = R.string.review_all_cards),
                    subtitle = stringResource(id = R.string.review_scope_subtitle_all_cards),
                    selected = selectedFilter == ReviewFilter.AllCards,
                    onClick = {
                        onSelectFilter(ReviewFilter.AllCards)
                    }
                )
            }

            if (availableDeckFilters.isNotEmpty()) {
                item {
                    Text(
                        text = stringResource(id = R.string.review_decks_title),
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp)
                    )
                }

                items(availableDeckFilters.size) { index ->
                    val deck = availableDeckFilters[index]
                    ReviewFilterOptionRow(
                        title = stringResource(
                            id = R.string.review_filter_title_with_count,
                            bidiWrap(
                                text = deck.title,
                                locale = locale
                            ),
                            deck.totalCount
                        ),
                        subtitle = stringResource(id = R.string.review_filtered_deck_subtitle),
                        selected = selectedFilter == ReviewFilter.Deck(deckId = deck.deckId),
                        onClick = {
                            onSelectFilter(ReviewFilter.Deck(deckId = deck.deckId))
                        }
                    )
                }
            }

            item {
                Text(
                    text = stringResource(id = R.string.review_effort_title),
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp)
                )
            }

            items(availableEffortFilters.size) { index ->
                val effortFilter = availableEffortFilters[index]
                ReviewFilterOptionRow(
                    title = stringResource(
                        id = R.string.review_filter_title_with_count,
                        bidiWrap(
                            text = reviewEffortLabel(effortLevel = effortFilter.effortLevel),
                            locale = locale
                        ),
                        effortFilter.totalCount
                    ),
                    subtitle = stringResource(id = R.string.review_virtual_effort_filter_subtitle),
                    selected = selectedFilter == ReviewFilter.Effort(effortLevel = effortFilter.effortLevel),
                    onClick = {
                        onSelectFilter(ReviewFilter.Effort(effortLevel = effortFilter.effortLevel))
                    }
                )
            }

            if (availableTagFilters.isNotEmpty()) {
                item {
                    Text(
                        text = stringResource(id = R.string.review_tags_title),
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp)
                    )
                }

                items(availableTagFilters.size) { index ->
                    val tag = availableTagFilters[index]
                    ReviewFilterOptionRow(
                        title = stringResource(
                            id = R.string.review_filter_title_with_count,
                            bidiWrap(
                                text = tag.tag,
                                locale = locale
                            ),
                            tag.totalCount
                        ),
                        subtitle = stringResource(id = R.string.review_workspace_tag_subtitle),
                        selected = selectedFilter == ReviewFilter.Tag(tag = tag.tag),
                        onClick = {
                            onSelectFilter(ReviewFilter.Tag(tag = tag.tag))
                        }
                    )
                }
            }

            item {
                HorizontalDivider(modifier = Modifier.padding(top = 8.dp))
            }

            item {
                TextButton(
                    onClick = onManageDecks,
                    modifier = Modifier.padding(horizontal = 24.dp)
                ) {
                    Text(stringResource(id = R.string.review_manage_filtered_decks))
                }
            }
        }
    }
}

@Composable
private fun ReviewFilterOptionRow(
    title: String,
    subtitle: String,
    selected: Boolean,
    onClick: () -> Unit
) {
    ListItem(
        headlineContent = {
            Text(title)
        },
        supportingContent = {
            Text(subtitle)
        },
        leadingContent = {
            RadioButton(
                selected = selected,
                onClick = null
            )
        },
        modifier = Modifier.clickable(onClick = onClick)
    )
}

@Composable
private fun reviewEffortLabel(effortLevel: EffortLevel): String {
    return when (effortLevel) {
        EffortLevel.FAST -> stringResource(id = R.string.review_fast)
        EffortLevel.MEDIUM -> stringResource(id = R.string.review_medium)
        EffortLevel.LONG -> stringResource(id = R.string.review_long)
    }
}
