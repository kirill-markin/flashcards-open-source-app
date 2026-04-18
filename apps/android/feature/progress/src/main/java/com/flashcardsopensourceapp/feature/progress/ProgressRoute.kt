package com.flashcardsopensourceapp.feature.progress

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner

private val progressSectionShape = RoundedCornerShape(28.dp)
private const val reviewChartVisibleGridLines: Int = 4
private val reviewChartColumnWidth = 24.dp
private val reviewChartColumnSpacing = 6.dp
private val reviewChartHorizontalPadding = 8.dp
private val reviewChartVerticalPadding = 12.dp
private val reviewChartHeight = 208.dp
private val reviewChartBarAreaHeight = reviewChartHeight - reviewChartVerticalPadding * 2
private val reviewChartAxisWidth = 28.dp
private val reviewChartLabelHeight = 20.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProgressRoute(
    uiState: ProgressUiState,
    onScreenVisible: () -> Unit,
    onRetry: () -> Unit
) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val currentScreenVisibleAction = rememberUpdatedState(newValue = onScreenVisible)

    DisposableEffect(lifecycleOwner) {
        if (shouldTriggerInitialProgressLoad(lifecycleState = lifecycleOwner.lifecycle.currentState)) {
            currentScreenVisibleAction.value()
        }

        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                currentScreenVisibleAction.value()
            }
        }

        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(stringResource(id = R.string.progress_title))
                }
            )
        }
    ) { innerPadding ->
        LazyColumn(
            contentPadding = PaddingValues(
                start = 16.dp,
                top = innerPadding.calculateTopPadding() + 16.dp,
                end = 16.dp,
                bottom = innerPadding.calculateBottomPadding() + 24.dp
            ),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.fillMaxSize()
        ) {
            when (uiState) {
                ProgressUiState.Loading -> {
                    item {
                        LoadingCard()
                    }
                }

                ProgressUiState.SignInRequired -> {
                    item {
                        GuidanceCard(
                            title = stringResource(id = R.string.progress_sign_in_required_title),
                            message = stringResource(id = R.string.progress_sign_in_required_message)
                        )
                    }
                }

                ProgressUiState.Unavailable -> {
                    item {
                        GuidanceCard(
                            title = stringResource(id = R.string.progress_unavailable_title),
                            message = stringResource(id = R.string.progress_unavailable_message)
                        )
                    }
                }

                is ProgressUiState.Error -> {
                    item {
                        ErrorCard(
                            message = uiState.message,
                            onRetry = onRetry
                        )
                    }
                }

                is ProgressUiState.Loaded -> {
                    item {
                        StreakSectionCard(
                            uiState = uiState.streakSection
                        )
                    }
                    item {
                        ReviewsSectionCard(
                            uiState = uiState.reviewsSection
                        )
                    }
                }
            }
        }
    }
}

internal fun shouldTriggerInitialProgressLoad(
    lifecycleState: Lifecycle.State
): Boolean {
    return lifecycleState == Lifecycle.State.RESUMED
}

@Composable
private fun LoadingCard() {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainer
        ),
        shape = progressSectionShape
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp)
        ) {
            CircularProgressIndicator()
            Text(
                text = stringResource(id = R.string.progress_loading),
                style = MaterialTheme.typography.bodyMedium
            )
        }
    }
}

@Composable
private fun GuidanceCard(
    title: String,
    message: String
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainer
        ),
        shape = progressSectionShape
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp)
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium
            )
            Text(
                text = message,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium
            )
        }
    }
}

@Composable
private fun ErrorCard(
    message: String,
    onRetry: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainer
        ),
        shape = progressSectionShape
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp)
        ) {
            Text(
                text = stringResource(id = R.string.progress_error_title),
                style = MaterialTheme.typography.titleMedium
            )
            Text(
                text = message,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium
            )
            TextButton(
                onClick = onRetry,
                modifier = Modifier.align(Alignment.End)
            ) {
                Text(stringResource(id = R.string.progress_retry))
            }
        }
    }
}

@Composable
private fun StreakSectionCard(
    uiState: ProgressStreakSectionUiState
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainer
        ),
        shape = progressSectionShape
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp)
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = stringResource(id = R.string.progress_streak_title),
                    style = MaterialTheme.typography.titleLarge
                )
                Text(
                    text = stringResource(id = R.string.progress_streak_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium
                )
            }

            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                uiState.weekdayLabels.forEach { label ->
                    Text(
                        text = label,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.labelMedium,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.weight(1f)
                    )
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                uiState.weeks.forEach { week ->
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        week.days.forEach { day ->
                            StreakDayCell(
                                day = day,
                                modifier = Modifier.weight(1f)
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StreakDayCell(
    day: ProgressStreakDayUiState,
    modifier: Modifier
) {
    if (day.isPlaceholder) {
        Box(
            modifier = modifier.aspectRatio(1f)
        )
        return
    }

    val hasReviews = day.reviewCount > 0
    val highlightColor = when {
        day.isToday -> MaterialTheme.colorScheme.primary.copy(alpha = 0.16f)
        hasReviews -> MaterialTheme.colorScheme.tertiary.copy(alpha = 0.12f)
        else -> Color.Transparent
    }
    val markerColor = when {
        day.isToday -> MaterialTheme.colorScheme.primary
        hasReviews -> MaterialTheme.colorScheme.surfaceContainerHighest
        else -> Color.Transparent
    }
    val markerContentColor = when {
        day.isToday -> MaterialTheme.colorScheme.onPrimary
        else -> MaterialTheme.colorScheme.primary
    }
    val dateTextColor = when {
        day.isToday -> MaterialTheme.colorScheme.primary
        else -> MaterialTheme.colorScheme.onSurface
    }

    Box(
        modifier = modifier
            .aspectRatio(1f)
            .clip(RoundedCornerShape(18.dp))
            .background(highlightColor),
        contentAlignment = Alignment.Center
    ) {
        if (hasReviews) {
            Box(
                modifier = Modifier
                    .size(34.dp)
                    .clip(CircleShape)
                    .background(markerColor),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Outlined.Check,
                    contentDescription = null,
                    tint = markerContentColor
                )
            }
        } else {
            val todayOutlineModifier = if (day.isToday) {
                Modifier.border(
                    width = 1.dp,
                    color = MaterialTheme.colorScheme.primary,
                    shape = CircleShape
                )
            } else {
                Modifier
            }

            Box(
                modifier = Modifier
                    .size(34.dp)
                    .then(todayOutlineModifier),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = requireNotNull(day.dayOfMonthLabel),
                    color = dateTextColor,
                    fontWeight = if (day.isToday) FontWeight.SemiBold else FontWeight.Normal,
                    style = MaterialTheme.typography.bodyMedium
                )
            }
        }
    }
}

@Composable
private fun ReviewsSectionCard(
    uiState: ProgressReviewsSectionUiState
) {
    val scrollState = rememberScrollState()
    val chartContentWidth = remember(uiState.days.size) {
        calculateChartContentWidth(dayCount = uiState.days.size)
    }
    val chartContainerWidth = chartContentWidth + reviewChartHorizontalPadding * 2
    val chartGridLineColor = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.45f)

    LaunchedEffect(uiState.days.size) {
        withFrameNanos {
            // Wait for the first measured frame before jumping to the newest edge.
        }
        scrollState.scrollTo(scrollState.maxValue)
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainer
        ),
        shape = progressSectionShape
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp)
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = stringResource(id = R.string.progress_reviews_title),
                    style = MaterialTheme.typography.titleLarge
                )
                Text(
                    text = stringResource(id = R.string.progress_reviews_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium
                )
            }

            Row(
                verticalAlignment = Alignment.Top,
                modifier = Modifier.fillMaxWidth()
            ) {
                ReviewsYAxis(
                    maxReviewCount = uiState.maxReviewCount,
                    modifier = Modifier
                        .padding(top = 6.dp)
                        .width(reviewChartAxisWidth)
                )

                Spacer(modifier = Modifier.width(12.dp))

                Column(
                    modifier = Modifier
                        .weight(1f)
                        .horizontalScroll(scrollState)
                ) {
                    Box(
                        modifier = Modifier
                            .width(chartContainerWidth)
                            .height(reviewChartHeight)
                            .clip(RoundedCornerShape(22.dp))
                            .background(MaterialTheme.colorScheme.surfaceContainerHighest)
                            .drawBehind {
                                val lineStep = size.height / reviewChartVisibleGridLines.toFloat()

                                repeat(reviewChartVisibleGridLines) { index ->
                                    val y = lineStep * index
                                    drawLine(
                                        color = chartGridLineColor,
                                        start = androidx.compose.ui.geometry.Offset(0f, y),
                                        end = androidx.compose.ui.geometry.Offset(size.width, y),
                                        strokeWidth = 1.dp.toPx()
                                    )
                                }
                            }
                            .padding(
                                horizontal = reviewChartHorizontalPadding,
                                vertical = reviewChartVerticalPadding
                            )
                    ) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(reviewChartColumnSpacing),
                            verticalAlignment = Alignment.Bottom,
                            modifier = Modifier.fillMaxSize()
                        ) {
                            uiState.days.forEach { day ->
                                ReviewBarColumn(
                                    day = day,
                                    maxReviewCount = uiState.maxReviewCount,
                                    modifier = Modifier
                                        .width(reviewChartColumnWidth)
                                        .fillMaxHeight()
                                )
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(8.dp))

                    Row(
                        horizontalArrangement = Arrangement.spacedBy(reviewChartColumnSpacing),
                        verticalAlignment = Alignment.Top,
                        modifier = Modifier
                            .padding(horizontal = reviewChartHorizontalPadding)
                            .width(chartContentWidth)
                    ) {
                        uiState.days.forEach { day ->
                            ReviewChartLabel(
                                day = day,
                                modifier = Modifier
                                    .width(reviewChartColumnWidth)
                                    .height(reviewChartLabelHeight)
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ReviewsYAxis(
    maxReviewCount: Int,
    modifier: Modifier
) {
    Column(
        verticalArrangement = Arrangement.SpaceBetween,
        horizontalAlignment = Alignment.End,
        modifier = modifier.height(reviewChartHeight + reviewChartLabelHeight + 8.dp)
    ) {
        Text(
            text = maxReviewCount.toString(),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.labelSmall
        )
        Text(
            text = "0",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.labelSmall
        )
    }
}

@Composable
private fun ReviewBarColumn(
    day: ProgressHistoryDayUiState,
    maxReviewCount: Int,
    modifier: Modifier
) {
    val backgroundColor = if (day.isToday) {
        MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)
    } else {
        Color.Transparent
    }
    val barColor = when {
        day.isToday -> MaterialTheme.colorScheme.primary
        day.reviewCount > 0 -> MaterialTheme.colorScheme.tertiary
        else -> MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.48f)
    }
    val barHeight = calculateBarHeight(
        reviewCount = day.reviewCount,
        maxReviewCount = maxReviewCount,
        maxBarHeight = reviewChartBarAreaHeight
    )

    Box(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .background(backgroundColor),
        contentAlignment = Alignment.BottomCenter
    ) {
        Box(
            modifier = Modifier
                .width(18.dp)
                .height(barHeight)
                .clip(RoundedCornerShape(topStart = 8.dp, topEnd = 8.dp, bottomStart = 8.dp, bottomEnd = 8.dp))
                .background(barColor)
        )
    }
}

@Composable
private fun ReviewChartLabel(
    day: ProgressHistoryDayUiState,
    modifier: Modifier
) {
    val labelText = when {
        day.isToday -> stringResource(id = R.string.progress_today)
        else -> day.chartLabel
    }

    Box(
        modifier = modifier,
        contentAlignment = Alignment.TopCenter
    ) {
        if (labelText != null) {
            Text(
                text = labelText,
                color = if (day.isToday) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
                fontWeight = if (day.isToday) FontWeight.SemiBold else FontWeight.Normal,
                style = MaterialTheme.typography.labelSmall,
                textAlign = TextAlign.Center
            )
        }
    }
}

private fun calculateChartContentWidth(
    dayCount: Int
): Dp {
    if (dayCount == 0) {
        return 0.dp
    }

    return reviewChartColumnWidth * dayCount +
        reviewChartColumnSpacing * (dayCount - 1)
}

private fun calculateBarHeight(
    reviewCount: Int,
    maxReviewCount: Int,
    maxBarHeight: Dp
): Dp {
    if (reviewCount == 0 || maxReviewCount == 0) {
        return 4.dp
    }

    return (maxBarHeight * (reviewCount.toFloat() / maxReviewCount.toFloat())).coerceAtLeast(8.dp)
}
