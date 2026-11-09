package com.flashcardsopensourceapp.feature.review

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.core.ui.bidiWrap
import com.flashcardsopensourceapp.core.ui.currentResourceLocale
import com.flashcardsopensourceapp.core.ui.deckNameComparator
import com.flashcardsopensourceapp.data.local.model.cards.normalizeTagKey
import com.flashcardsopensourceapp.data.local.model.review.ReviewDeckFilterOption
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.review.ReviewTagFilterOption
import com.flashcardsopensourceapp.data.local.model.review.makeReviewTagFilter
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ReviewFilterSheet(
    selectedFilter: ReviewFilter,
    availableDeckFilters: List<ReviewDeckFilterOption>,
    availableTagFilters: List<ReviewTagFilterOption>,
    areFilterOptionsLoaded: Boolean,
    onDismiss: () -> Unit,
    onApplyFilter: (ReviewFilter) -> Unit,
    onToggleTag: (String) -> Unit,
    onManageDecks: () -> Unit
) {
    val context = LocalContext.current
    val configuration = LocalConfiguration.current
    val locale = remember(configuration) { currentResourceLocale(resources = context.resources) }
    val sortedDeckFilters = remember(availableDeckFilters, locale) {
        availableDeckFilters.sortedWith(
            deckNameComparator(
                locale = locale,
                name = ReviewDeckFilterOption::title,
                deckId = ReviewDeckFilterOption::deckId
            )
        )
    }
    val selectedTagKeys: Set<String> = selectedReviewTagKeys(selectedFilter = selectedFilter)
    val sheetState = rememberModalBottomSheetState()
    val coroutineScope = rememberCoroutineScope()

    // All cards and decks are a single choice: it applies at once and the sheet hides with its own animation.
    fun applyFilterAndHide(filter: ReviewFilter): Unit {
        onApplyFilter(filter)
        coroutineScope.launch { sheetState.hide() }.invokeOnCompletion {
            if (sheetState.isVisible.not()) {
                onDismiss()
            }
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
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
                        applyFilterAndHide(filter = ReviewFilter.AllCards)
                    }
                )
            }

            if (areFilterOptionsLoaded.not()) {
                item {
                    ListItem(
                        headlineContent = {
                            Text(stringResource(id = R.string.review_loading))
                        },
                        leadingContent = {
                            CircularProgressIndicator(
                                strokeWidth = 2.dp,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    )
                }
            }

            if (availableDeckFilters.isNotEmpty()) {
                item {
                    Text(
                        text = stringResource(id = R.string.review_decks_title),
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp)
                    )
                }

                items(sortedDeckFilters, key = { deck -> deck.deckId }) { deck ->
                    val deckFilter: ReviewFilter = ReviewFilter.Deck(deckId = deck.deckId)
                    val isSelected = selectedFilter == deckFilter
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
                        selected = isSelected,
                        testTag = reviewFilterDeckOptionTag(deckId = deck.deckId),
                        onClick = {
                            val nextFilter: ReviewFilter = if (isSelected) {
                                ReviewFilter.AllCards
                            } else {
                                deckFilter
                            }
                            applyFilterAndHide(filter = nextFilter)
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

// Only an explicit tag selection ticks tag rows; All cards and decks tick none.
internal fun selectedReviewTagKeys(selectedFilter: ReviewFilter): Set<String> {
    return when (selectedFilter) {
        ReviewFilter.AllCards, is ReviewFilter.Deck -> emptySet()
        is ReviewFilter.Tags -> selectedFilter.tags.map { tagName ->
            normalizeTagKey(tag = tagName)
        }.toSet()
    }
}

// A tag tapped under All cards or a deck starts a new selection of only that tag; removing the last tag selects All cards.
internal fun toggleReviewTagFilter(
    selectedFilter: ReviewFilter,
    toggledTagName: String
): ReviewFilter {
    if (selectedFilter !is ReviewFilter.Tags) {
        return makeReviewTagFilter(tagNames = listOf(toggledTagName))
    }

    val toggledTagKey: String = normalizeTagKey(tag = toggledTagName)
    val isToggledTagSelected: Boolean = selectedFilter.tags.any { tagName ->
        normalizeTagKey(tag = tagName) == toggledTagKey
    }
    val nextTagNames: List<String> = if (isToggledTagSelected) {
        selectedFilter.tags.filter { tagName ->
            normalizeTagKey(tag = tagName) != toggledTagKey
        }
    } else {
        selectedFilter.tags + toggledTagName
    }
    if (nextTagNames.isEmpty()) {
        return ReviewFilter.AllCards
    }

    return makeReviewTagFilter(tagNames = nextTagNames)
}
