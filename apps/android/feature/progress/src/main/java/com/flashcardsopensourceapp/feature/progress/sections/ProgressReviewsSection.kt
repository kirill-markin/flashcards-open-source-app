package com.flashcardsopensourceapp.feature.progress.sections

import android.icu.text.DateIntervalFormat
import android.icu.util.DateInterval
import android.icu.util.TimeZone
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.feature.progress.ProgressHistoryDayUiState
import com.flashcardsopensourceapp.feature.progress.ProgressReviewPageUiState
import com.flashcardsopensourceapp.feature.progress.ProgressReviewsSectionUiState
import com.flashcardsopensourceapp.feature.progress.R
import java.text.NumberFormat
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.ceil

private const val reviewChartVisibleGridLines: Int = 4
private val reviewChartColumnSpacing = 6.dp
private val reviewChartHorizontalPadding = 8.dp
private val reviewChartVerticalPadding = 12.dp
private val reviewChartHeight = 208.dp
private val reviewChartBarAreaHeight = reviewChartHeight - reviewChartVerticalPadding * 2
private val reviewChartAxisWidth = 28.dp
private val reviewChartLabelHeight = 20.dp
private val reviewAgainColor = Color(0xFFD7263D)
private val reviewHardColor = Color(0xFFE69F00)
private val reviewGoodColor = Color(0xFF2BB673)
private val reviewEasyColor = Color(0xFF3F7CC8)

private enum class ReviewRatingChartKey {
    AGAIN,
    HARD,
    GOOD,
    EASY
}

private data class ReviewRatingLegendRowUiState(
    val key: ReviewRatingChartKey,
    val labelResId: Int,
    val count: Int,
    val percentageLabel: String,
    val color: Color,
    val isSelected: Boolean
)

private data class ReviewChartBarSegment(
    val count: Int,
    val color: Color
)

@Composable
internal fun ReviewsSectionCard(
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
    var selectedReviewDateKey by rememberSaveable {
        mutableStateOf<String?>(null)
    }
    var selectedRatingKey by rememberSaveable {
        mutableStateOf<ReviewRatingChartKey?>(null)
    }
    val pageStartDateKeys = remember(uiState.pages) {
        uiState.pages.map { page -> page.startDateKey }
    }
    val chartGridLineColor = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.45f)
    val previousWeekLabel = stringResource(id = R.string.progress_reviews_previous_week)
    val nextWeekLabel = stringResource(id = R.string.progress_reviews_next_week)
    val clearSelectionLabel = stringResource(id = R.string.progress_reviews_chart_clear_content_description)

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
    val hasChartSelection = selectedReviewDateKey != null || selectedRatingKey != null
    val legendRows = remember(visiblePage, selectedRatingKey, selectedReviewDateKey, locale) {
        visiblePage?.let { page ->
            createReviewRatingLegendRows(
                page = page,
                selectedRatingKey = selectedRatingKey,
                selectedReviewDateKey = selectedReviewDateKey,
                locale = locale
            )
        } ?: emptyList()
    }
    val chartUpperBound = remember(visiblePage, selectedRatingKey) {
        visiblePage?.let { page ->
            calculateVisibleReviewChartUpperBound(
                page = page,
                selectedRatingKey = selectedRatingKey
            )
        } ?: 1
    }
    val selectedRatingCount = remember(legendRows, selectedRatingKey) {
        selectedRatingKey?.let { ratingKey ->
            legendRows.firstOrNull { row -> row.key == ratingKey }?.count
        }
    }

    LaunchedEffect(visiblePage?.startDateKey, selectedReviewDateKey) {
        val activePage = visiblePage ?: return@LaunchedEffect
        val selectedDateKey = selectedReviewDateKey ?: return@LaunchedEffect
        if (activePage.days.none { day -> day.date.toString() == selectedDateKey }) {
            selectedReviewDateKey = null
        }
    }

    LaunchedEffect(visiblePage?.startDateKey, selectedRatingKey, selectedRatingCount) {
        if (selectedRatingKey != null && (selectedRatingCount == null || selectedRatingCount == 0)) {
            selectedRatingKey = null
        }
    }

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
                        val pageRangeLabel = remember(page, selectedReviewDateKey, locale) {
                            formatProgressReviewVisibleDateLabel(
                                page = page,
                                selectedReviewDateKey = selectedReviewDateKey,
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
                                    selectedReviewDateKey = null
                                    selectedRatingKey = null
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
                                    selectedReviewDateKey = null
                                    selectedRatingKey = null
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
                Row(
                    verticalAlignment = Alignment.Top,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    ReviewsYAxis(
                        upperBound = chartUpperBound,
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
                                .clickable(enabled = hasChartSelection) {
                                    selectedReviewDateKey = null
                                    selectedRatingKey = null
                                }
                                .semantics {
                                    if (hasChartSelection) {
                                        contentDescription = clearSelectionLabel
                                        role = Role.Button
                                    }
                                }
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
                                    val dayKey = day.date.toString()
                                    val isSelectedDay = selectedReviewDateKey == dayKey
                                    val dayContentDescriptionLabel = remember(day.date, locale) {
                                        formatProgressReviewDayContentDescriptionLabel(
                                            date = day.date,
                                            locale = locale
                                        )
                                    }
                                    ReviewBarColumn(
                                        day = day,
                                        contentDescriptionLabel = dayContentDescriptionLabel,
                                        upperBound = chartUpperBound,
                                        selectedRatingKey = selectedRatingKey,
                                        isSelected = isSelectedDay,
                                        isDimmed = selectedReviewDateKey != null && isSelectedDay.not(),
                                        onClick = {
                                            selectedReviewDateKey = if (isSelectedDay) {
                                                null
                                            } else {
                                                dayKey
                                            }
                                            selectedRatingKey = null
                                        },
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
                                val dayKey = day.date.toString()
                                val isSelectedDay = selectedReviewDateKey == dayKey
                                ReviewChartLabel(
                                    day = day,
                                    isSelected = isSelectedDay,
                                    isDimmed = selectedReviewDateKey != null && isSelectedDay.not(),
                                    modifier = Modifier
                                        .weight(1f)
                                        .height(reviewChartLabelHeight)
                                )
                            }
                        }

                        Spacer(modifier = Modifier.height(12.dp))

                        ReviewRatingLegend(
                            rows = legendRows,
                            onSelectRating = { ratingKey ->
                                selectedRatingKey = if (selectedRatingKey == ratingKey) {
                                    null
                                } else {
                                    ratingKey
                                }
                                selectedReviewDateKey = null
                            },
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
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
    contentDescriptionLabel: String,
    upperBound: Int,
    selectedRatingKey: ReviewRatingChartKey?,
    isSelected: Boolean,
    isDimmed: Boolean,
    onClick: () -> Unit,
    modifier: Modifier
) {
    val dimmedBarColor = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.62f)
    val segments = createReviewChartBarSegments(
        day = day,
        selectedRatingKey = selectedRatingKey,
        isDimmed = isDimmed,
        dimmedBarColor = dimmedBarColor
    )
    val visibleReviewCount = segments.sumOf(ReviewChartBarSegment::count)
    val backgroundColor = if (isDimmed) {
        Color.Transparent
    } else if (isSelected) {
        MaterialTheme.colorScheme.primary.copy(alpha = 0.14f)
    } else if (day.isToday && visibleReviewCount == 0) {
        MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)
    } else {
        Color.Transparent
    }
    val zeroBarColor = if (isDimmed) {
        dimmedBarColor
    } else if (isSelected || day.isToday) {
        MaterialTheme.colorScheme.primary
    } else {
        MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.48f)
    }
    val barHeight = calculateBarHeight(
        reviewCount = visibleReviewCount,
        upperBound = upperBound,
        maxBarHeight = reviewChartBarAreaHeight
    )
    val contentDescriptionText = if (isSelected) {
        pluralStringResource(
            id = R.plurals.progress_reviews_day_selected_content_description,
            count = visibleReviewCount,
            contentDescriptionLabel,
            visibleReviewCount
        )
    } else {
        pluralStringResource(
            id = R.plurals.progress_reviews_day_content_description,
            count = visibleReviewCount,
            contentDescriptionLabel,
            visibleReviewCount
        )
    }

    Box(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .background(backgroundColor)
            .clickable(onClick = onClick)
            .semantics {
                contentDescription = contentDescriptionText
                role = Role.Button
                selected = isSelected
            },
        contentAlignment = Alignment.BottomCenter
    ) {
        if (segments.isEmpty()) {
            Box(
                modifier = Modifier
                    .width(18.dp)
                    .height(barHeight)
                    .clip(RoundedCornerShape(topStart = 8.dp, topEnd = 8.dp, bottomStart = 8.dp, bottomEnd = 8.dp))
                    .background(zeroBarColor)
            )
        } else {
            Column(
                modifier = Modifier
                    .width(18.dp)
                    .height(barHeight)
                    .clip(RoundedCornerShape(topStart = 8.dp, topEnd = 8.dp, bottomStart = 8.dp, bottomEnd = 8.dp))
            ) {
                segments.asReversed().forEach { segment ->
                    Box(
                        modifier = Modifier
                            .weight(segment.count.toFloat())
                            .fillMaxWidth()
                            .background(segment.color)
                    )
                }
            }
        }
    }
}

@Composable
private fun ReviewChartLabel(
    day: ProgressHistoryDayUiState,
    isSelected: Boolean,
    isDimmed: Boolean,
    modifier: Modifier
) {
    Box(
        modifier = modifier,
        contentAlignment = Alignment.TopCenter
    ) {
        Text(
            text = day.dayOfMonthLabel,
            color = if (isDimmed) {
                MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.56f)
            } else if (isSelected || day.isToday) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            fontWeight = if (isSelected || day.isToday) FontWeight.SemiBold else FontWeight.Normal,
            style = MaterialTheme.typography.labelSmall,
            textAlign = TextAlign.Center
        )
    }
}

@Composable
private fun ReviewRatingLegend(
    rows: List<ReviewRatingLegendRowUiState>,
    onSelectRating: (ReviewRatingChartKey) -> Unit,
    modifier: Modifier
) {
    Column(
        verticalArrangement = Arrangement.spacedBy(6.dp),
        modifier = modifier
    ) {
        rows.forEach { row ->
            ReviewRatingLegendItem(
                row = row,
                onClick = {
                    onSelectRating(row.key)
                }
            )
        }
    }
}

@Composable
private fun ReviewRatingLegendItem(
    row: ReviewRatingLegendRowUiState,
    onClick: () -> Unit
) {
    val rowTextColor = if (row.count == 0) {
        MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.56f)
    } else {
        MaterialTheme.colorScheme.onSurface
    }
    val rowBackgroundColor = if (row.isSelected) {
        MaterialTheme.colorScheme.surfaceVariant
    } else {
        Color.Transparent
    }
    val isInteractive = row.count > 0

    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(rowBackgroundColor)
            .clickable(
                enabled = isInteractive,
                onClick = onClick
            )
            .padding(horizontal = 8.dp, vertical = 6.dp)
            .semantics(mergeDescendants = true) {
                if (isInteractive) {
                    role = Role.Button
                    selected = row.isSelected
                }
            }
    ) {
        Box(
            modifier = Modifier
                .width(10.dp)
                .height(10.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(
                    if (row.count == 0) {
                        row.color.copy(alpha = 0.32f)
                    } else {
                        row.color
                    }
                )
        )

        Spacer(modifier = Modifier.width(8.dp))

        Text(
            text = stringResource(id = row.labelResId),
            color = rowTextColor,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.weight(1f)
        )

        Text(
            text = stringResource(
                id = R.string.progress_reviews_rating_count_percentage,
                row.count,
                row.percentageLabel
            ),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
            textAlign = TextAlign.End
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

private fun createReviewChartBarSegments(
    day: ProgressHistoryDayUiState,
    selectedRatingKey: ReviewRatingChartKey?,
    isDimmed: Boolean,
    dimmedBarColor: Color
): List<ReviewChartBarSegment> {
    val ratingKeys = selectedRatingKey?.let { ratingKey ->
        listOf(ratingKey)
    } ?: ReviewRatingChartKey.entries

    return ratingKeys.mapNotNull { ratingKey ->
        val count = ratingKey.reviewCount(day = day)
        if (count == 0) {
            return@mapNotNull null
        }

        ReviewChartBarSegment(
            count = count,
            color = if (isDimmed) {
                dimmedBarColor
            } else {
                ratingKey.reviewColor()
            }
        )
    }
}

private fun createReviewRatingLegendRows(
    page: ProgressReviewPageUiState,
    selectedRatingKey: ReviewRatingChartKey?,
    selectedReviewDateKey: String?,
    locale: Locale
): List<ReviewRatingLegendRowUiState> {
    val selectedDay = selectedReviewDateKey?.let { dateKey ->
        page.days.firstOrNull { day -> day.date.toString() == dateKey }
    }
    val legendDays = if (selectedDay == null) {
        page.days
    } else {
        listOf(selectedDay)
    }
    val totalReviewCount = legendDays.sumOf(ProgressHistoryDayUiState::reviewCount)
    return ReviewRatingChartKey.entries.map { ratingKey ->
        val count = legendDays.sumOf { day ->
            ratingKey.reviewCount(day = day)
        }
        ReviewRatingLegendRowUiState(
            key = ratingKey,
            labelResId = ratingKey.labelResId(),
            count = count,
            percentageLabel = formatProgressReviewRatingPercentage(
                count = count,
                totalReviewCount = totalReviewCount,
                locale = locale
            ),
            color = ratingKey.reviewColor(),
            isSelected = selectedRatingKey == ratingKey
        )
    }
}

private fun formatProgressReviewVisibleDateLabel(
    page: ProgressReviewPageUiState,
    selectedReviewDateKey: String?,
    locale: Locale
): String {
    val selectedDay = selectedReviewDateKey?.let { dateKey ->
        page.days.firstOrNull { day -> day.date.toString() == dateKey }
    }

    if (selectedDay != null) {
        return formatProgressReviewDayContentDescriptionLabel(
            date = selectedDay.date,
            locale = locale
        )
    }

    return formatProgressReviewPageRange(
        startDate = page.startDate,
        endDate = page.endDate,
        locale = locale
    )
}

private fun calculateVisibleReviewChartUpperBound(
    page: ProgressReviewPageUiState,
    selectedRatingKey: ReviewRatingChartKey?
): Int {
    val maximumReviewCount = page.days.maxOfOrNull { day ->
        selectedRatingKey?.reviewCount(day = day) ?: day.reviewCount
    } ?: 0

    return calculateReviewChartUpperBound(maximumReviewCount = maximumReviewCount)
}

private fun calculateReviewChartUpperBound(
    maximumReviewCount: Int
): Int {
    if (maximumReviewCount <= 0) {
        return 1
    }

    return maxOf(1, ceil(maximumReviewCount * 1.1).toInt())
}

private fun formatProgressReviewRatingPercentage(
    count: Int,
    totalReviewCount: Int,
    locale: Locale
): String {
    val percentage = if (totalReviewCount == 0) {
        0.0
    } else {
        count.toDouble() / totalReviewCount.toDouble()
    }
    return NumberFormat.getPercentInstance(locale).apply {
        maximumFractionDigits = 0
    }.format(percentage)
}

private fun ReviewRatingChartKey.reviewCount(
    day: ProgressHistoryDayUiState
): Int {
    return when (this) {
        ReviewRatingChartKey.AGAIN -> day.againCount
        ReviewRatingChartKey.HARD -> day.hardCount
        ReviewRatingChartKey.GOOD -> day.goodCount
        ReviewRatingChartKey.EASY -> day.easyCount
    }
}

private fun ReviewRatingChartKey.reviewColor(): Color {
    return when (this) {
        ReviewRatingChartKey.AGAIN -> reviewAgainColor
        ReviewRatingChartKey.HARD -> reviewHardColor
        ReviewRatingChartKey.GOOD -> reviewGoodColor
        ReviewRatingChartKey.EASY -> reviewEasyColor
    }
}

private fun ReviewRatingChartKey.labelResId(): Int {
    return when (this) {
        ReviewRatingChartKey.AGAIN -> R.string.progress_reviews_rating_again
        ReviewRatingChartKey.HARD -> R.string.progress_reviews_rating_hard
        ReviewRatingChartKey.GOOD -> R.string.progress_reviews_rating_good
        ReviewRatingChartKey.EASY -> R.string.progress_reviews_rating_easy
    }
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

private fun formatProgressReviewDayContentDescriptionLabel(
    date: LocalDate,
    locale: Locale
): String {
    return DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)
        .withLocale(locale)
        .format(date)
}

private fun LocalDate.toUtcEpochMillis(): Long {
    return atStartOfDay()
        .toInstant(ZoneOffset.UTC)
        .toEpochMilli()
}
