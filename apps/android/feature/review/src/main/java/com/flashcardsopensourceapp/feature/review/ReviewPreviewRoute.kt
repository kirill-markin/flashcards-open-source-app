package com.flashcardsopensourceapp.feature.review

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReviewPreviewRoute(
    uiState: ReviewUiState,
    onStartPreview: () -> Unit,
    onLoadNextPreviewPageIfNeeded: (String) -> Unit,
    onRetryPreview: () -> Unit,
    onOpenCard: (String) -> Unit,
    onBack: () -> Unit
) {
    LaunchedEffect(Unit) {
        onStartPreview()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(uiState.selectedFilterTitle)
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = stringResource(id = R.string.review_preview_back_content_description)
                        )
                    }
                }
            )
        }
    ) { innerPadding ->
        LazyColumn(
            contentPadding = PaddingValues(
                start = 16.dp,
                top = innerPadding.calculateTopPadding() + 16.dp,
                end = 16.dp,
                bottom = innerPadding.calculateBottomPadding() + 16.dp
            ),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize()
        ) {
            if (uiState.isPreviewLoading && uiState.previewItems.isEmpty()) {
                item {
                    LoadingReviewState()
                }
            } else if (uiState.previewItems.isEmpty() && uiState.previewErrorMessage.isNotEmpty()) {
                item {
                    PreviewErrorCard(
                        message = uiState.previewErrorMessage,
                        onRetry = onRetryPreview
                    )
                }
            } else if (uiState.previewItems.isEmpty()) {
                item {
                    StaticEmptyReviewState(
                        title = stringResource(id = R.string.review_preview_empty_title),
                        body = stringResource(id = R.string.review_preview_empty_body)
                    )
                }
            } else {
                itemsIndexed(
                    items = uiState.previewItems,
                    key = { _, item ->
                        item.itemId
                    }
                ) { _, item ->
                    when (item) {
                        is ReviewPreviewListItem.SectionHeader -> {
                            PreviewSectionSeparator(title = item.title)
                        }

                        is ReviewPreviewListItem.CardEntry -> {
                            PreviewCardRow(
                                item = item,
                                onOpenCard = onOpenCard
                            )

                            LaunchedEffect(
                                key1 = item.presentation.card.cardId,
                                key2 = uiState.previewItems.size
                            ) {
                                onLoadNextPreviewPageIfNeeded(item.presentation.card.cardId)
                            }
                        }
                    }
                }

                if (uiState.previewErrorMessage.isNotEmpty()) {
                    item {
                        PreviewErrorCard(
                            message = uiState.previewErrorMessage,
                            onRetry = onRetryPreview
                        )
                    }
                } else if (uiState.isPreviewLoading) {
                    item {
                        Box(
                            contentAlignment = Alignment.Center,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(16.dp)
                        ) {
                            CircularProgressIndicator()
                        }
                    }
                }
            }
        }
    }
}
