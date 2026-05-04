package com.flashcardsopensourceapp.feature.progress

import android.icu.text.DateIntervalFormat
import android.icu.util.DateInterval
import android.icu.util.TimeZone
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.flashcardsopensourceapp.data.local.model.ProgressReviewScheduleBucketKey
import java.text.NumberFormat
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.Locale
import kotlin.math.atan2
import kotlin.math.min
import kotlin.math.sqrt

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
const val progressReviewScheduleSectionTag: String = "progress_review_schedule_section"
const val progressReviewScheduleDonutChartTag: String = "progress_review_schedule_donut_chart"

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
                    val reviewScheduleSection = uiState.reviewScheduleSection
                    if (reviewScheduleSection != null) {
                        item {
                            ReviewScheduleSectionCard(
                                uiState = reviewScheduleSection
                            )
                        }
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
            }
        }
    }
}

@Composable
private fun ReviewScheduleSectionCard(
    uiState: ProgressReviewScheduleSectionUiState
) {
    val configuration = LocalConfiguration.current
    val locale = if (configuration.locales.isEmpty) {
        Locale.getDefault()
    } else {
        configuration.locales[0]
    }
    val countFormatter = remember(locale) {
        NumberFormat.getIntegerInstance(locale)
    }
    val percentFormatter = remember(locale) {
        NumberFormat.getPercentInstance(locale).apply {
            maximumFractionDigits = 0
        }
    }
    val bucketColors = reviewScheduleBucketColors
    val selectedRowBackground = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.20f)
    var selectedBucketKey by rememberSaveable { mutableStateOf<ProgressReviewScheduleBucketKey?>(null) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .testTag(progressReviewScheduleSectionTag)
            .pointerInput(Unit) {
                detectTapGestures(onTap = { selectedBucketKey = null })
            },
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
            Text(
                text = stringResource(id = R.string.progress_review_schedule_title),
                style = MaterialTheme.typography.titleLarge
            )

            if (uiState.hasCards) {
                ReviewScheduleDonutChart(
                    uiState = uiState,
                    bucketColors = bucketColors,
                    selectedBucketKey = selectedBucketKey,
                    accentColor = MaterialTheme.colorScheme.primary,
                    onTapSegment = { tappedKey ->
                        selectedBucketKey = if (tappedKey == null) {
                            null
                        } else if (selectedBucketKey == tappedKey) {
                            null
                        } else {
                            tappedKey
                        }
                    },
                    modifier = Modifier.align(Alignment.CenterHorizontally)
                )
            } else {
                Text(
                    text = stringResource(id = R.string.progress_review_schedule_empty),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium
                )
            }

            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                uiState.buckets.forEach { bucket ->
                    ReviewScheduleLegendRow(
                        bucket = bucket,
                        color = bucketColors.getValue(bucket.key),
                        countLabel = countFormatter.format(bucket.count.toLong()),
                        percentageLabel = percentFormatter.format(bucket.percentage.toDouble()),
                        isSelected = selectedBucketKey == bucket.key,
                        isAnySelected = selectedBucketKey != null,
                        selectedBackground = selectedRowBackground,
                        onClick = {
                            selectedBucketKey = if (selectedBucketKey == bucket.key) {
                                null
                            } else {
                                bucket.key
                            }
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun ReviewScheduleDonutChart(
    uiState: ProgressReviewScheduleSectionUiState,
    bucketColors: Map<ProgressReviewScheduleBucketKey, Color>,
    selectedBucketKey: ProgressReviewScheduleBucketKey?,
    accentColor: Color,
    onTapSegment: (ProgressReviewScheduleBucketKey?) -> Unit,
    modifier: Modifier
) {
    val baseChartDescription = stringResource(id = R.string.progress_review_schedule_chart_content_description)
    val selectedBucketLabel = selectedBucketKey?.let { reviewScheduleBucketLabel(bucketKey = it) }
    val chartDescription = if (selectedBucketLabel != null) {
        "$baseChartDescription, $selectedBucketLabel"
    } else {
        baseChartDescription
    }
    val emptyTrackColor = MaterialTheme.colorScheme.surfaceContainerHighest
    val strokeWidth = 28.dp
    val ringStrokeWidth = 2.dp
    val ringGap = 3.dp
    val strokeWidthPx = with(LocalDensity.current) { strokeWidth.toPx() }
    val currentOnTapSegment by rememberUpdatedState(onTapSegment)
    val currentBuckets by rememberUpdatedState(uiState.buckets)

    Canvas(
        modifier = modifier
            .size(184.dp)
            .testTag(progressReviewScheduleDonutChartTag)
            .pointerInput(Unit) {
                detectTapGestures { offset ->
                    val tappedKey = bucketKeyAtOffset(
                        offset = offset,
                        canvasWidth = size.width.toFloat(),
                        canvasHeight = size.height.toFloat(),
                        strokeWidthPx = strokeWidthPx,
                        buckets = currentBuckets
                    )
                    currentOnTapSegment(tappedKey)
                }
            }
            .semantics {
                contentDescription = chartDescription
                liveRegion = LiveRegionMode.Polite
            }
    ) {
        val diameter = min(size.width, size.height) - strokeWidthPx
        val topLeft = Offset(
            x = (size.width - diameter) / 2f,
            y = (size.height - diameter) / 2f
        )
        val arcSize = Size(width = diameter, height = diameter)
        drawArc(
            color = emptyTrackColor,
            startAngle = -90f,
            sweepAngle = 360f,
            useCenter = false,
            topLeft = topLeft,
            size = arcSize,
            style = Stroke(
                width = strokeWidthPx,
                cap = StrokeCap.Butt
            )
        )

        val nonEmptyBuckets = uiState.buckets.filter { bucket ->
            bucket.count > 0
        }
        var startAngle = -90f
        var selectedSegmentStart: Float? = null
        var selectedSegmentSweep: Float? = null
        nonEmptyBuckets.forEach { bucket ->
            val sweepAngle = 360f * bucket.percentage
            val isDimmed = selectedBucketKey != null && selectedBucketKey != bucket.key
            val baseColor = bucketColors.getValue(bucket.key)
            drawArc(
                color = if (isDimmed) baseColor.copy(alpha = 0.35f) else baseColor,
                startAngle = startAngle,
                sweepAngle = sweepAngle,
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = Stroke(
                    width = strokeWidthPx,
                    cap = StrokeCap.Butt
                )
            )
            if (selectedBucketKey == bucket.key) {
                selectedSegmentStart = startAngle
                selectedSegmentSweep = sweepAngle
            }
            startAngle += sweepAngle
        }

        val ringStartAngle = selectedSegmentStart
        val ringSweepAngle = selectedSegmentSweep
        if (ringStartAngle != null && ringSweepAngle != null) {
            val ringStrokePx = ringStrokeWidth.toPx()
            val ringGapPx = ringGap.toPx()
            val ringDiameter = diameter + strokeWidthPx + ringGapPx * 2 + ringStrokePx
            val ringTopLeft = Offset(
                x = (size.width - ringDiameter) / 2f,
                y = (size.height - ringDiameter) / 2f
            )
            val ringSize = Size(width = ringDiameter, height = ringDiameter)
            drawArc(
                color = accentColor,
                startAngle = ringStartAngle,
                sweepAngle = ringSweepAngle,
                useCenter = false,
                topLeft = ringTopLeft,
                size = ringSize,
                style = Stroke(
                    width = ringStrokePx,
                    cap = StrokeCap.Round
                )
            )
        }
    }
}

@Composable
private fun ReviewScheduleLegendRow(
    bucket: ProgressReviewScheduleBucketUiState,
    color: Color,
    countLabel: String,
    percentageLabel: String,
    isSelected: Boolean,
    isAnySelected: Boolean,
    selectedBackground: Color,
    onClick: () -> Unit
) {
    val rowAlpha = if (isAnySelected && isSelected.not()) 0.35f else 1f
    val backgroundColor = if (isSelected) selectedBackground else Color.Transparent
    val isInteractive = bucket.count > 0
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(backgroundColor)
            .clickable(enabled = isInteractive, onClick = onClick)
            .alpha(rowAlpha)
            .padding(horizontal = 8.dp, vertical = 6.dp)
            .semantics(mergeDescendants = true) {
                if (isInteractive) {
                    role = Role.Button
                    selected = isSelected
                }
            }
    ) {
        Box(
            modifier = Modifier
                .size(12.dp)
                .background(color, CircleShape)
                .border(
                    width = 0.5.dp,
                    color = MaterialTheme.colorScheme.outlineVariant,
                    shape = CircleShape
                )
        )
        Text(
            text = reviewScheduleBucketLabel(bucketKey = bucket.key),
            color = MaterialTheme.colorScheme.onSurface,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.weight(1f)
        )
        Text(
            text = stringResource(
                id = R.string.progress_review_schedule_bucket_value,
                countLabel,
                percentageLabel
            ),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.End
        )
    }
}

// Canonical palette — see docs/progress-pie-palette.md.
// Keep the hex values in sync with the iOS and Web clients.
private val reviewScheduleBucketColors: Map<ProgressReviewScheduleBucketKey, Color> = mapOf(
    ProgressReviewScheduleBucketKey.NEW to Color(0xFFF4C430),
    ProgressReviewScheduleBucketKey.TODAY to Color(0xFFD7263D),
    ProgressReviewScheduleBucketKey.DAYS_1_TO_7 to Color(0xFF1FB5C1),
    ProgressReviewScheduleBucketKey.DAYS_8_TO_30 to Color(0xFF8E5BD9),
    ProgressReviewScheduleBucketKey.DAYS_31_TO_90 to Color(0xFF2BB673),
    ProgressReviewScheduleBucketKey.DAYS_91_TO_360 to Color(0xFFE69F00),
    ProgressReviewScheduleBucketKey.YEARS_1_TO_2 to Color(0xFF3F7CC8),
    ProgressReviewScheduleBucketKey.LATER to Color(0xFF7A8088),
)

// Pure helper: maps a tap on the donut canvas to the bucket whose wedge it lands on,
// or null when the tap falls outside the ring (donut hole or canvas corners).
private fun bucketKeyAtOffset(
    offset: Offset,
    canvasWidth: Float,
    canvasHeight: Float,
    strokeWidthPx: Float,
    buckets: List<ProgressReviewScheduleBucketUiState>
): ProgressReviewScheduleBucketKey? {
    val centerX = canvasWidth / 2f
    val centerY = canvasHeight / 2f
    val dx = offset.x - centerX
    val dy = offset.y - centerY
    val distance = sqrt(dx * dx + dy * dy)
    val centralRadius = (min(canvasWidth, canvasHeight) - strokeWidthPx) / 2f
    val halfBand = strokeWidthPx / 2f
    if (distance < centralRadius - halfBand || distance > centralRadius + halfBand) {
        return null
    }
    val nonEmpty = buckets.filter { it.count > 0 }
    if (nonEmpty.isEmpty()) {
        return null
    }
    val rawDegrees = Math.toDegrees(atan2(dy.toDouble(), dx.toDouble())).toFloat()
    val angleFromTop = ((rawDegrees + 90f) % 360f + 360f) % 360f
    var startAngle = 0f
    nonEmpty.forEach { bucket ->
        val sweepAngle = 360f * bucket.percentage
        if (angleFromTop >= startAngle && angleFromTop < startAngle + sweepAngle) {
            return bucket.key
        }
        startAngle += sweepAngle
    }
    return nonEmpty.last().key
}

@Composable
private fun reviewScheduleBucketLabel(
    bucketKey: ProgressReviewScheduleBucketKey
): String {
    val stringResId = when (bucketKey) {
        ProgressReviewScheduleBucketKey.NEW -> R.string.progress_review_schedule_bucket_new
        ProgressReviewScheduleBucketKey.TODAY -> R.string.progress_review_schedule_bucket_today
        ProgressReviewScheduleBucketKey.DAYS_1_TO_7 -> R.string.progress_review_schedule_bucket_days_1_to_7
        ProgressReviewScheduleBucketKey.DAYS_8_TO_30 -> R.string.progress_review_schedule_bucket_days_8_to_30
        ProgressReviewScheduleBucketKey.DAYS_31_TO_90 -> R.string.progress_review_schedule_bucket_days_31_to_90
        ProgressReviewScheduleBucketKey.DAYS_91_TO_360 -> R.string.progress_review_schedule_bucket_days_91_to_360
        ProgressReviewScheduleBucketKey.YEARS_1_TO_2 -> R.string.progress_review_schedule_bucket_years_1_to_2
        ProgressReviewScheduleBucketKey.LATER -> R.string.progress_review_schedule_bucket_later
    }

    return stringResource(id = stringResId)
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
