package com.flashcardsopensourceapp.feature.review

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.core.ui.bidiWrap
import com.flashcardsopensourceapp.core.ui.currentResourceLocale
import com.flashcardsopensourceapp.data.local.model.cards.normalizeTagKey
import com.flashcardsopensourceapp.data.local.model.review.ReviewDeckFilterOption
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.review.ReviewTagFilterOption
import com.flashcardsopensourceapp.data.local.model.review.makeReviewTagFilter
import com.flashcardsopensourceapp.data.local.model.review.resolveReviewTagFilter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ReviewFilterSheet(
    selectedFilter: ReviewFilter,
    availableDeckFilters: List<ReviewDeckFilterOption>,
    availableTagFilters: List<ReviewTagFilterOption>,
    onDismiss: () -> Unit,
    onSelectFilter: (ReviewFilter) -> Unit,
    onToggleTag: (String) -> Unit,
    onManageDecks: () -> Unit
) {
    val context = LocalContext.current
    val locale = currentResourceLocale(resources = context.resources)
    val selectedTagNames = selectedReviewTagNames(
        selectedFilter = selectedFilter,
        availableDeckFilters = availableDeckFilters,
        availableTagFilters = availableTagFilters
    )
    val selectedTagKeys: Set<String> = selectedTagNames.map { tagName ->
        normalizeTagKey(tag = tagName)
    }.toSet()

    ModalBottomSheet(onDismissRequest = onDismiss) {
        LazyColumn(
            contentPadding = PaddingValues(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier
                .fillMaxWidth()
                .testTag(reviewFilterSheetTag)
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
                    testTag = reviewFilterAllCardsOptionTag,
                    onClick = {
                        val nextFilter: ReviewFilter = if (selectedFilter == ReviewFilter.AllCards) {
                            makeReviewTagFilter(tagNames = emptyList())
                        } else {
                            ReviewFilter.AllCards
                        }
                        onSelectFilter(nextFilter)
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
                        testTag = reviewFilterDeckOptionTag(deckId = deck.deckId),
                        onClick = {
                            onSelectFilter(ReviewFilter.Deck(deckId = deck.deckId))
                        }
                    )
                }
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
                        selected = selectedTagKeys.contains(normalizeTagKey(tag = tag.tag)),
                        testTag = reviewFilterTagOptionTag(tag = tag.tag),
                        onClick = {
                            onToggleTag(tag.tag)
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
                    modifier = Modifier
                        .padding(horizontal = 24.dp)
                        .testTag(reviewManageDecksButtonTag)
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
    testTag: String,
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
            Checkbox(
                checked = selected,
                onCheckedChange = null
            )
        },
        modifier = Modifier
            .testTag(testTag)
            .toggleable(
                value = selected,
                role = Role.Checkbox,
                onValueChange = {
                    onClick()
                }
            )
    )
}

internal fun selectedReviewTagNames(
    selectedFilter: ReviewFilter,
    availableDeckFilters: List<ReviewDeckFilterOption>,
    availableTagFilters: List<ReviewTagFilterOption>
): List<String> {
    val availableTagNames: List<String> = availableTagFilters.map(ReviewTagFilterOption::tag)
    val requestedTagNames: List<String> = when (selectedFilter) {
        ReviewFilter.AllCards -> availableTagNames
        is ReviewFilter.Deck -> availableDeckFilters.firstOrNull { deck ->
            deck.deckId == selectedFilter.deckId
        }?.let { deck ->
            if (deck.tags.isEmpty()) {
                availableTagNames
            } else {
                deck.tags
            }
        } ?: emptyList()
        is ReviewFilter.Tags -> selectedFilter.tags
    }
    val requestedTagKeys: Set<String> = requestedTagNames.map { tagName ->
        normalizeTagKey(tag = tagName)
    }.toSet()

    return availableTagNames.filter { availableTagName ->
        requestedTagKeys.contains(normalizeTagKey(tag = availableTagName))
    }
}

internal fun toggleReviewTagFilter(
    selectedFilter: ReviewFilter,
    toggledTagName: String,
    availableDeckFilters: List<ReviewDeckFilterOption>,
    availableTagFilters: List<ReviewTagFilterOption>
): ReviewFilter {
    val availableTagNames: List<String> = availableTagFilters.map(ReviewTagFilterOption::tag)
    val currentTagNames: List<String> = if (selectedFilter is ReviewFilter.Tags) {
        selectedFilter.tags
    } else {
        selectedReviewTagNames(
            selectedFilter = selectedFilter,
            availableDeckFilters = availableDeckFilters,
            availableTagFilters = availableTagFilters
        )
    }
    val toggledTagKey: String = normalizeTagKey(tag = toggledTagName)
    val currentTagKeys: Set<String> = currentTagNames.map { tagName ->
        normalizeTagKey(tag = tagName)
    }.toSet()
    val nextTagNames: List<String> = if (currentTagKeys.contains(toggledTagKey)) {
        currentTagNames.filter { tagName ->
            normalizeTagKey(tag = tagName) != toggledTagKey
        }
    } else {
        currentTagNames + toggledTagName
    }

    val resolvedFilter = resolveReviewTagFilter(
        selectedTagNames = nextTagNames,
        availableTagNames = availableTagNames
    )
    return if (resolvedFilter == ReviewFilter.AllCards) {
        ReviewFilter.AllCards
    } else {
        makeReviewTagFilter(tagNames = nextTagNames)
    }
}
