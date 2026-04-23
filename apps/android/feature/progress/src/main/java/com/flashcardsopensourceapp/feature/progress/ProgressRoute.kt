package com.flashcardsopensourceapp.feature.progress

import android.icu.text.DateIntervalFormat
import android.icu.util.DateInterval
import android.icu.util.TimeZone
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.LocalFireDepartment
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.Locale

private val progressSectionShape = RoundedCornerShape(28.dp)
private const val reviewChartVisibleGridLines: Int = 4
private val reviewChartColumnSpacing = 6.dp
private val reviewChartHorizontalPadding = 8.dp
private val reviewChartVerticalPadding = 12.dp
private val reviewChartHeight = 208.dp
private val reviewChartBarAreaHeight = reviewChartHeight - reviewChartVerticalPadding * 2
private val reviewChartAxisWidth = 28.dp
private val reviewChartLabelHeight = 20.dp
private const val progressStreakOverflowThreshold: Int = 99
const val progressStreakSectionTag: String = "progress_streak_section"
const val progressReviewsSectionTag: String = "progress_reviews_section"
const val progressReviewsActivityChartTag: String = "progress_reviews_activity_chart"

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
                            summary = uiState.summary,
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
    message: String?,
    onRetry: () -> Unit
) {
    val resolvedMessage = message?.takeIf { errorMessage ->
        errorMessage.isNotBlank()
    } ?: stringResource(id = R.string.progress_error_message)

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
                text = resolvedMessage,
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
    summary: ProgressSummaryUiState,
    uiState: ProgressStreakSectionUiState
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .testTag(progressStreakSectionTag),
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

            ProgressStreakSummary(summary = summary)

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
private fun ProgressStreakSummary(
    summary: ProgressSummaryUiState
) {
    when (summary) {
        ProgressSummaryUiState.Loading -> Unit

        is ProgressSummaryUiState.Loaded -> {
            val streakDays = summary.summary.currentStreakDays
            val contentColor = if (summary.summary.hasReviewedToday) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            }
            val contentDescription = pluralStringResource(
                id = R.plurals.progress_streak_summary_content_description,
                count = streakDays,
                streakDays
            )
            val stateDescription = stringResource(
                id = if (summary.summary.hasReviewedToday) {
                    R.string.progress_streak_summary_reviewed_today
                } else {
                    R.string.progress_streak_summary_not_reviewed_today
                }
            )

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier
                    .semantics(mergeDescendants = true) {
                        this.contentDescription = contentDescription
                        this.stateDescription = stateDescription
                    }
                    .clip(RoundedCornerShape(18.dp))
                    .background(MaterialTheme.colorScheme.surfaceContainerHighest)
                    .padding(horizontal = 12.dp, vertical = 8.dp)
            ) {
                Icon(
                    imageVector = Icons.Outlined.LocalFireDepartment,
                    contentDescription = null,
                    tint = contentColor
                )
                Text(
                    text = formatProgressStreakValue(
                        streakDays = streakDays
                    ),
                    color = contentColor,
                    fontWeight = FontWeight.SemiBold,
                    style = MaterialTheme.typography.titleMedium
                )
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
        hasReviews -> Color.Transparent
        day.isToday -> MaterialTheme.colorScheme.primary.copy(alpha = 0.16f)
        else -> Color.Transparent
    }
    val markerColor = MaterialTheme.colorScheme.primary
    val markerContentColor = MaterialTheme.colorScheme.onPrimary
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
                    imageVector = Icons.Outlined.LocalFireDepartment,
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
                day.dayOfMonthLabel?.let { dayOfMonthLabel ->
                    Text(
                        text = dayOfMonthLabel,
                        color = dateTextColor,
                        fontWeight = if (day.isToday) FontWeight.SemiBold else FontWeight.Normal,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }
        }
    }
}

@Composable
private fun ReviewsSectionCard(
    uiState: ProgressReviewsSectionUiState
) {
    val configuration = LocalConfiguration.current
    val locale = if (configuration.locales.isEmpty) {
        Locale.getDefault()
    } else {
        configuration.locales[0]
    }
    var selectedPageStartDateKey by rememberSaveable {
        mutableStateOf<String?>(null)
    }
    val pageStartDateKeys = remember(uiState.pages) {
        uiState.pages.map { page -> page.startDateKey }
    }
    val chartGridLineColor = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.45f)
    val previousWeekLabel = stringResource(id = R.string.progress_reviews_previous_week)
    val nextWeekLabel = stringResource(id = R.string.progress_reviews_next_week)
    val emptyWeekLabel = stringResource(id = R.string.progress_reviews_empty_week)

    LaunchedEffect(pageStartDateKeys) {
        if (selectedPageStartDateKey == null) {
            return@LaunchedEffect
        }

        if (selectedPageStartDateKey !in pageStartDateKeys) {
            selectedPageStartDateKey = pageStartDateKeys.lastOrNull()
        }
    }

    val selectedPageIndex = remember(selectedPageStartDateKey, uiState.pages) {
        if (uiState.pages.isEmpty()) {
            0
        } else {
            uiState.pages.indexOfFirst { page ->
                page.startDateKey == selectedPageStartDateKey
            }.takeIf { index ->
                index >= 0
            } ?: (uiState.pages.size - 1)
        }
    }
    val visiblePage = uiState.pages.getOrNull(selectedPageIndex)

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .testTag(progressReviewsSectionTag),
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
            Row(
                verticalAlignment = Alignment.Top,
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier.weight(1f)
                ) {
                    Text(
                        text = stringResource(id = R.string.progress_reviews_title),
                        style = MaterialTheme.typography.titleLarge
                    )
                    visiblePage?.let { page ->
                        val pageRangeLabel = remember(page.startDate, page.endDate, locale) {
                            formatProgressReviewPageRange(
                                startDate = page.startDate,
                                endDate = page.endDate,
                                locale = locale
                            )
                        }
                        Text(
                            text = pageRangeLabel,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                }

                if (uiState.pages.size > 1) {
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        TextButton(
                            modifier = Modifier.semantics {
                                contentDescription = previousWeekLabel
                            },
                            enabled = selectedPageIndex > 0,
                            onClick = {
                                if (selectedPageIndex > 0) {
                                    selectedPageStartDateKey = uiState.pages[selectedPageIndex - 1].startDateKey
                                }
                            }
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                                contentDescription = null
                            )
                        }
                        TextButton(
                            modifier = Modifier.semantics {
                                contentDescription = nextWeekLabel
                            },
                            enabled = selectedPageIndex < uiState.pages.lastIndex,
                            onClick = {
                                if (selectedPageIndex < uiState.pages.lastIndex) {
                                    selectedPageStartDateKey = uiState.pages[selectedPageIndex + 1].startDateKey
                                }
                            }
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Outlined.ArrowForward,
                                contentDescription = null
                            )
                        }
                    }
                }
            }

            visiblePage?.let { page ->
                if (page.hasReviewActivity) {
                    Row(
                        verticalAlignment = Alignment.Top,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        ReviewsYAxis(
                            upperBound = page.upperBound,
                            modifier = Modifier
                                .padding(top = 6.dp)
                                .width(reviewChartAxisWidth)
                        )

                        Spacer(modifier = Modifier.width(12.dp))

                        Column(
                            modifier = Modifier.weight(1f)
                        ) {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(reviewChartHeight)
                                    .testTag(progressReviewsActivityChartTag)
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
                                    page.days.forEach { day ->
                                        ReviewBarColumn(
                                            day = day,
                                            upperBound = page.upperBound,
                                            modifier = Modifier
                                                .weight(1f)
                                                .fillMaxHeight()
                                        )
                                    }
                                }
                            }

                            Spacer(modifier = Modifier.height(8.dp))

                            Row(
                                horizontalArrangement = Arrangement.spacedBy(reviewChartColumnSpacing),
                                verticalAlignment = Alignment.Top,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                page.days.forEach { day ->
                                    ReviewChartLabel(
                                        day = day,
                                        modifier = Modifier
                                            .weight(1f)
                                            .height(reviewChartLabelHeight)
                                    )
                                }
                            }
                        }
                    }
                } else {
                    Text(
                        text = emptyWeekLabel,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }
        }
    }
}

@Composable
private fun ReviewsYAxis(
    upperBound: Int,
    modifier: Modifier
) {
    Column(
        verticalArrangement = Arrangement.SpaceBetween,
        horizontalAlignment = Alignment.End,
        modifier = modifier.height(reviewChartHeight + reviewChartLabelHeight + 8.dp)
    ) {
        Text(
            text = upperBound.toString(),
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
    upperBound: Int,
    modifier: Modifier
) {
    val backgroundColor = if (day.isToday && day.reviewCount == 0) {
        MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)
    } else {
        Color.Transparent
    }
    val barColor = when {
        day.reviewCount > 0 -> MaterialTheme.colorScheme.primary
        day.isToday -> MaterialTheme.colorScheme.primary
        else -> MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.48f)
    }
    val barHeight = calculateBarHeight(
        reviewCount = day.reviewCount,
        upperBound = upperBound,
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
    Box(
        modifier = modifier,
        contentAlignment = Alignment.TopCenter
    ) {
        Text(
            text = day.dayOfMonthLabel,
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

private fun calculateBarHeight(
    reviewCount: Int,
    upperBound: Int,
    maxBarHeight: Dp
): Dp {
    if (reviewCount == 0 || upperBound == 0) {
        return 4.dp
    }

    return (maxBarHeight * (reviewCount.toFloat() / upperBound.toFloat())).coerceAtLeast(8.dp)
}

private fun formatProgressStreakValue(
    streakDays: Int
): String {
    if (streakDays > progressStreakOverflowThreshold) {
        return "${progressStreakOverflowThreshold}+"
    }

    return streakDays.toString()
}

private fun formatProgressReviewPageRange(
    startDate: LocalDate,
    endDate: LocalDate,
    locale: Locale
): String {
    val formatter = DateIntervalFormat.getInstance("yMMMd", locale).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    return formatter.format(
        DateInterval(
            startDate.toUtcEpochMillis(),
            endDate.toUtcEpochMillis()
        )
    )
}

private fun LocalDate.toUtcEpochMillis(): Long {
    return atStartOfDay()
        .toInstant(ZoneOffset.UTC)
        .toEpochMilli()
}
