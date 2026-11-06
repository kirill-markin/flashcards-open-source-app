package com.flashcardsopensourceapp.feature.cards.catalog

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.painter.ColorPainter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.flashcardsopensourceapp.data.local.model.catalog.CatalogBrowseIndexDeck
import com.flashcardsopensourceapp.data.local.model.catalog.CatalogDeckCardPreview
import com.flashcardsopensourceapp.feature.cards.R
import com.flashcardsopensourceapp.feature.cards.catalogDeckCardPreviewTag
import com.flashcardsopensourceapp.feature.cards.catalogDeckDescriptionTag
import com.flashcardsopensourceapp.feature.cards.catalogDeckPageErrorTag
import com.flashcardsopensourceapp.feature.cards.catalogDeckPageLoadingTag
import com.flashcardsopensourceapp.feature.cards.catalogDeckPageRetryButtonTag
import com.flashcardsopensourceapp.feature.cards.catalogDeckScreenTag
import com.flashcardsopensourceapp.feature.cards.catalogDeckStudyButtonTag
import com.flashcardsopensourceapp.feature.cards.catalogDeckStudyErrorTag
import com.flashcardsopensourceapp.feature.cards.formatCardsCount
import com.flashcardsopensourceapp.feature.review.ReviewClassifiedMarkdownText

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CatalogDeckRoute(
    uiState: CatalogDeckUiState,
    onStudyDeck: () -> Unit,
    onRetryPage: () -> Unit,
    onBack: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {},
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = stringResource(id = R.string.catalog_back_content_description)
                        )
                    }
                }
            )
        }
    ) { innerPadding ->
        val contentModifier = Modifier
            .fillMaxSize()
            .padding(innerPadding)
            .consumeWindowInsets(innerPadding)
            .testTag(catalogDeckScreenTag)
        val deck = uiState.deck
        if (deck == null) {
            Box(contentAlignment = Alignment.Center, modifier = contentModifier) {
                CircularProgressIndicator()
            }
        } else {
            LazyColumn(
                contentPadding = PaddingValues(start = 16.dp, top = 8.dp, end = 16.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                modifier = contentModifier
            ) {
                catalogDeckHeader(
                    deck = deck,
                    studyStatus = uiState.studyStatus,
                    onStudyDeck = onStudyDeck
                )
                catalogDeckPageContent(page = uiState.page, onRetryPage = onRetryPage)
            }
        }
    }
}

private fun LazyListScope.catalogDeckHeader(
    deck: CatalogBrowseIndexDeck,
    studyStatus: CatalogDeckStudyStatus,
    onStudyDeck: () -> Unit
) {
    if (deck.coverImageUrl != null) {
        item(key = "cover") {
            val placeholderPainter = ColorPainter(MaterialTheme.colorScheme.surfaceContainerHighest)
            AsyncImage(
                model = deck.coverImageUrl,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                placeholder = placeholderPainter,
                error = placeholderPainter,
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(ratio = 16f / 9f)
                    .clip(RoundedCornerShape(12.dp))
            )
        }
    }
    item(key = "title") {
        val resources = LocalResources.current
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(text = deck.title, style = MaterialTheme.typography.headlineSmall)
            Text(
                text = stringResource(
                    id = R.string.catalog_deck_author_and_card_count,
                    deck.authorDisplayName,
                    pluralStringResource(
                        id = R.plurals.catalog_deck_card_count,
                        count = deck.cardCount,
                        formatCardsCount(resources = resources, count = deck.cardCount)
                    )
                ),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(text = deck.summary, style = MaterialTheme.typography.bodyLarge)
        }
    }
    item(key = "study") {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = onStudyDeck,
                enabled = studyStatus != CatalogDeckStudyStatus.RUNNING,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag(catalogDeckStudyButtonTag)
            ) {
                if (studyStatus == CatalogDeckStudyStatus.RUNNING) {
                    CircularProgressIndicator(
                        color = LocalContentColor.current,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(18.dp)
                    )
                } else {
                    Text(stringResource(id = R.string.catalog_deck_study))
                }
            }
            if (studyStatus == CatalogDeckStudyStatus.FAILED) {
                Text(
                    text = stringResource(id = R.string.catalog_deck_study_failed),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.testTag(catalogDeckStudyErrorTag)
                )
            }
        }
    }
}

private fun LazyListScope.catalogDeckPageContent(
    page: CatalogDeckPageUiState,
    onRetryPage: () -> Unit
) {
    when (page) {
        CatalogDeckPageUiState.Loading -> item(key = "page_loading") {
            Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp)) {
                CircularProgressIndicator(modifier = Modifier.testTag(catalogDeckPageLoadingTag))
            }
        }

        CatalogDeckPageUiState.LoadFailed -> item(key = "page_failed") {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = stringResource(id = R.string.catalog_deck_page_load_failed),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.testTag(catalogDeckPageErrorTag)
                )
                TextButton(
                    onClick = onRetryPage,
                    modifier = Modifier.testTag(catalogDeckPageRetryButtonTag)
                ) {
                    Text(stringResource(id = R.string.catalog_retry))
                }
            }
        }

        is CatalogDeckPageUiState.Ready -> {
            if (page.page.description.isNotBlank()) {
                item(key = "description") {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            text = stringResource(id = R.string.catalog_deck_about_title),
                            style = MaterialTheme.typography.titleMedium
                        )
                        ReviewClassifiedMarkdownText(
                            text = page.page.description,
                            style = MaterialTheme.typography.bodyLarge,
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag(catalogDeckDescriptionTag)
                        )
                    }
                }
            }
            if (page.page.cards.isNotEmpty()) {
                item(key = "cards_title") {
                    Text(
                        text = stringResource(id = R.string.catalog_deck_first_cards_title),
                        style = MaterialTheme.typography.titleMedium
                    )
                }
                items(page.page.cards, key = { card -> "card_${card.ordinal}" }) { card ->
                    CatalogDeckCardPreviewItem(card = card)
                }
            }
        }
    }
}

@Composable
private fun CatalogDeckCardPreviewItem(card: CatalogDeckCardPreview) {
    OutlinedCard(
        modifier = Modifier
            .fillMaxWidth()
            .testTag(catalogDeckCardPreviewTag)
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(16.dp)
        ) {
            ReviewClassifiedMarkdownText(
                text = card.frontText,
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.fillMaxWidth()
            )
            HorizontalDivider()
            ReviewClassifiedMarkdownText(
                text = card.backText,
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}
