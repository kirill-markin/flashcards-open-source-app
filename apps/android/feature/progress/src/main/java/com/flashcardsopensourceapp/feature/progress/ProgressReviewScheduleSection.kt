package com.flashcardsopensourceapp.feature.progress

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.ProgressReviewScheduleBucketKey
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.atan2
import kotlin.math.min
import kotlin.math.sqrt

@Composable
internal fun ReviewScheduleSectionCard(
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

// Canonical palette - see docs/progress-pie-palette.md.
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
