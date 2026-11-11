package com.flashcardsopensourceapp.wear.review

import android.icu.text.DisplayContext
import android.icu.text.RelativeDateTimeFormatter
import android.icu.util.ULocale
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.TransformingLazyColumnItemScope
import androidx.wear.compose.foundation.lazy.TransformingLazyColumnScope
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.CompactButton
import androidx.wear.compose.material3.EdgeButton
import androidx.wear.compose.material3.EdgeButtonSize
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.ListHeader
import androidx.wear.compose.material3.ListHeaderDefaults
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.SurfaceTransformation
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.TextDefaults
import androidx.wear.compose.material3.lazy.TransformationSpec
import androidx.wear.compose.material3.lazy.rememberTransformationSpec
import androidx.wear.compose.material3.lazy.transformedHeight
import com.flashcardsopensourceapp.data.local.model.review.ReviewCard
import com.flashcardsopensourceapp.data.local.model.review.ReviewRating
import com.flashcardsopensourceapp.wear.R
import com.flashcardsopensourceapp.wear.ui.transformedListItem
import java.time.Instant
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.util.Locale
import kotlin.math.roundToLong

private const val minuteMillis: Long = 60_000L
private const val hourMillis: Long = 60L * minuteMillis
private const val dayMillis: Long = 24L * hourMillis
private val answerDividerHeight: Dp = 1.dp

@Composable
fun WearReviewScreen(viewModel: WearReviewViewModel) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    LifecycleResumeEffect(viewModel) {
        viewModel.refreshKeepingShownCard()
        onPauseOrDispose {}
    }

    when (val content = uiState.content) {
        // A new card starts at the top instead of the previous card's scroll position.
        is WearReviewContent.Card -> key(content.card.cardId) {
            WearReviewCardScreen(
                card = content.card,
                isAnswerRevealed = content.isAnswerRevealed,
                submissionFailureMessage = uiState.submissionFailureMessage,
                onShowAnswer = viewModel::revealAnswer,
                onRate = viewModel::rate
            )
        }

        is WearReviewContent.AllDone -> WearReviewAllDoneScreen(
            nextDueAtMillis = content.nextDueAtMillis,
            submissionFailureMessage = uiState.submissionFailureMessage
        )

        is WearReviewContent.Failed -> WearReviewFailureScreen(
            message = content.message,
            submissionFailureMessage = uiState.submissionFailureMessage,
            onRetry = viewModel::retry
        )

        WearReviewContent.Loading -> WearReviewLoadingScreen(
            submissionFailureMessage = uiState.submissionFailureMessage
        )
    }
}

/** Show answer and the four ratings stay docked below the scrolling card. */
@Composable
private fun WearReviewCardScreen(
    card: ReviewCard,
    isAnswerRevealed: Boolean,
    submissionFailureMessage: String?,
    onShowAnswer: () -> Unit,
    onRate: (ReviewRating) -> Unit
) {
    val frontText = remember(card.frontText) { makeWearReviewCardSideText(markdown = card.frontText) }
    val backText = remember(card.backText) { makeWearReviewCardSideText(markdown = card.backText) }
    val listState = rememberTransformingLazyColumnState()
    val transformationSpec = rememberTransformationSpec()
    val answerDividerIndex = if (submissionFailureMessage != null) 2 else 1
    val answerDividerHeightPx = with(LocalDensity.current) { answerDividerHeight.roundToPx() }
    // A card restored after a failed save appears revealed and starts at the top like any new card.
    val isAnswerRevealedOnAppear = remember { isAnswerRevealed }

    LaunchedEffect(isAnswerRevealed) {
        if (isAnswerRevealed && isAnswerRevealedOnAppear.not()) {
            // The offset is from the screen's center, so this brings the divider to the top of the list.
            val layoutInfo = listState.layoutInfo
            listState.animateScrollToItem(
                index = answerDividerIndex,
                scrollOffset = layoutInfo.viewportSize.height / 2 - layoutInfo.beforeContentPadding - answerDividerHeightPx / 2
            )
        }
    }

    BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
        val isScreenRound = LocalConfiguration.current.isScreenRound
        // A round screen narrows toward the bottom, so the rating grid keeps clear of the curve.
        val ratingGridHorizontalPadding = if (isScreenRound) maxWidth * 0.17f else 8.dp
        val ratingGridBottomPadding = if (isScreenRound) maxHeight * 0.06f else 8.dp

        Column(modifier = Modifier.fillMaxSize()) {
            ScreenScaffold(scrollState = listState, modifier = Modifier.weight(1f)) { contentPadding ->
                val layoutDirection = LocalLayoutDirection.current
                TransformingLazyColumn(
                    state = listState,
                    // The list draws past its bounds, which would show the card between the docked buttons.
                    modifier = Modifier.clipToBounds(),
                    // The list ends at the docked buttons, not the screen's curved edge, so its end rests just
                    // above them.
                    contentPadding = PaddingValues(
                        start = contentPadding.calculateStartPadding(layoutDirection),
                        top = contentPadding.calculateTopPadding(),
                        end = contentPadding.calculateEndPadding(layoutDirection),
                        bottom = 0.dp
                    )
                ) {
                    if (submissionFailureMessage != null) {
                        item {
                            WearReviewSubmissionFailureListItem(
                                message = submissionFailureMessage,
                                transformationSpec = transformationSpec
                            )
                        }
                    }
                    item {
                        WearReviewCardSide(
                            sideText = frontText,
                            textStyle = MaterialTheme.typography.titleMedium,
                            transformationSpec = transformationSpec
                        )
                    }
                    if (isAnswerRevealed) {
                        item {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .transformedListItem(itemScope = this, transformationSpec = transformationSpec)
                                    .height(answerDividerHeight)
                                    .background(MaterialTheme.colorScheme.outlineVariant)
                            )
                        }
                        item {
                            WearReviewCardSide(
                                sideText = backText,
                                textStyle = MaterialTheme.typography.bodyMedium,
                                transformationSpec = transformationSpec
                            )
                        }
                    }
                }
            }

            if (isAnswerRevealed) {
                WearReviewRatingGrid(
                    modifier = Modifier.padding(
                        start = ratingGridHorizontalPadding,
                        end = ratingGridHorizontalPadding,
                        top = 4.dp,
                        bottom = ratingGridBottomPadding
                    ),
                    onRate = onRate
                )
            } else {
                EdgeButton(
                    onClick = onShowAnswer,
                    modifier = Modifier.align(Alignment.CenterHorizontally),
                    buttonSize = EdgeButtonSize.Medium
                ) {
                    Text(text = stringResource(R.string.wear_review_show_answer), textAlign = TextAlign.Center)
                }
            }
        }
    }
}

@Composable
private fun TransformingLazyColumnItemScope.WearReviewCardSide(
    sideText: WearReviewCardSideText,
    textStyle: TextStyle,
    transformationSpec: TransformationSpec
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .transformedListItem(itemScope = this, transformationSpec = transformationSpec)
            // The docked buttons, not the screen's curved edge, end the list, so the end needs no extra room.
            .minimumVerticalContentPadding(top = TextDefaults.minimumTopListContentPadding, bottom = 0.dp)
            // Either side can sit at the top, on appear or after the reveal scroll, so it takes a header's
            // padding, clear of a round screen's curve.
            .padding(ListHeaderDefaults.ContentPadding),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        if (sideText.text.isNotEmpty()) {
            Text(text = sideText.text, modifier = Modifier.fillMaxWidth(), style = textStyle)
        }
        if (sideText.hasOmittedContent) {
            Text(
                text = stringResource(R.string.wear_review_open_on_phone),
                modifier = Modifier.fillMaxWidth(),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

@Composable
private fun WearReviewRatingGrid(modifier: Modifier, onRate: (ReviewRating) -> Unit) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            WearReviewRatingButton(rating = ReviewRating.AGAIN, modifier = Modifier.weight(1f), onRate = onRate)
            WearReviewRatingButton(rating = ReviewRating.HARD, modifier = Modifier.weight(1f), onRate = onRate)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            WearReviewRatingButton(rating = ReviewRating.GOOD, modifier = Modifier.weight(1f), onRate = onRate)
            WearReviewRatingButton(rating = ReviewRating.EASY, modifier = Modifier.weight(1f), onRate = onRate)
        }
    }
}

@Composable
private fun WearReviewRatingButton(rating: ReviewRating, modifier: Modifier, onRate: (ReviewRating) -> Unit) {
    CompactButton(
        onClick = { onRate(rating) },
        modifier = modifier,
        colors = ButtonDefaults.filledTonalButtonColors()
    ) {
        Text(
            text = stringResource(ratingTitleResource(rating = rating)),
            modifier = Modifier.fillMaxWidth(),
            textAlign = TextAlign.Center,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

private fun ratingTitleResource(rating: ReviewRating): Int {
    return when (rating) {
        ReviewRating.AGAIN -> R.string.wear_review_again
        ReviewRating.HARD -> R.string.wear_review_hard
        ReviewRating.GOOD -> R.string.wear_review_good
        ReviewRating.EASY -> R.string.wear_review_easy
    }
}

@Composable
private fun WearReviewSubmissionFailureText(message: String, modifier: Modifier) {
    Text(
        text = message,
        modifier = modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.error,
        style = MaterialTheme.typography.bodySmall,
        textAlign = TextAlign.Center
    )
}

@Composable
private fun TransformingLazyColumnItemScope.WearReviewSubmissionFailureListItem(
    message: String,
    transformationSpec: TransformationSpec
) {
    WearReviewSubmissionFailureText(
        message = message,
        modifier = Modifier
            .transformedListItem(itemScope = this, transformationSpec = transformationSpec)
            .minimumVerticalContentPadding(TextDefaults.minimumTopListContentPadding)
            // Opens the list, so it takes a header's padding, clear of a round screen's curve.
            .padding(ListHeaderDefaults.ContentPadding)
    )
}

@Composable
private fun WearReviewAllDoneScreen(nextDueAtMillis: Long?, submissionFailureMessage: String?) {
    val locale = LocalConfiguration.current.locales[0]
    WearReviewMessageScreen(submissionFailureMessage = submissionFailureMessage) { transformationSpec ->
        item {
            Icon(
                painter = painterResource(R.drawable.wear_review_all_done),
                contentDescription = null,
                modifier = Modifier
                    .transformedListItem(itemScope = this, transformationSpec = transformationSpec)
                    .minimumVerticalContentPadding(ListHeaderDefaults.minimumTopListContentPadding)
                    .size(32.dp),
                tint = MaterialTheme.colorScheme.primary
            )
        }
        item {
            WearReviewMessageTitle(
                text = stringResource(R.string.wear_review_all_done),
                transformationSpec = transformationSpec
            )
        }
        if (nextDueAtMillis != null) {
            item {
                Text(
                    text = stringResource(
                        R.string.wear_review_next_card_due,
                        formatRelativeTime(
                            timeMillis = nextDueAtMillis,
                            nowMillis = System.currentTimeMillis(),
                            locale = locale,
                            zoneId = ZoneId.systemDefault()
                        )
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .transformedListItem(itemScope = this, transformationSpec = transformationSpec)
                        .minimumVerticalContentPadding(TextDefaults.minimumBottomListContentPadding),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center
                )
            }
        }
    }
}

@Composable
private fun WearReviewFailureScreen(message: String, submissionFailureMessage: String?, onRetry: () -> Unit) {
    WearReviewMessageScreen(submissionFailureMessage = submissionFailureMessage) { transformationSpec ->
        item {
            WearReviewMessageTitle(text = message, transformationSpec = transformationSpec)
        }
        item {
            Button(
                onClick = onRetry,
                modifier = Modifier
                    .fillMaxWidth()
                    .transformedHeight(this, transformationSpec)
                    .minimumVerticalContentPadding(ButtonDefaults.minimumVerticalListContentPadding),
                transformation = SurfaceTransformation(transformationSpec)
            ) {
                Text(text = stringResource(R.string.wear_retry))
            }
        }
    }
}

@Composable
private fun WearReviewLoadingScreen(submissionFailureMessage: String?) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            modifier = Modifier.padding(horizontal = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            if (submissionFailureMessage != null) {
                WearReviewSubmissionFailureText(message = submissionFailureMessage, modifier = Modifier)
            }
            CircularProgressIndicator()
        }
    }
}

@Composable
private fun TransformingLazyColumnItemScope.WearReviewMessageTitle(text: String, transformationSpec: TransformationSpec) {
    ListHeader(
        modifier = Modifier
            .fillMaxWidth()
            .transformedHeight(this, transformationSpec)
            .minimumVerticalContentPadding(ListHeaderDefaults.minimumTopListContentPadding),
        transformation = SurfaceTransformation(transformationSpec)
    ) {
        // A header stops at three lines; a failure message is shown whole.
        Text(text = text, textAlign = TextAlign.Center, maxLines = Int.MAX_VALUE)
    }
}

@Composable
private fun WearReviewMessageScreen(
    submissionFailureMessage: String?,
    content: TransformingLazyColumnScope.(TransformationSpec) -> Unit
) {
    val listState = rememberTransformingLazyColumnState()
    val transformationSpec = rememberTransformationSpec()
    ScreenScaffold(scrollState = listState) { contentPadding ->
        TransformingLazyColumn(state = listState, contentPadding = contentPadding) {
            if (submissionFailureMessage != null) {
                item {
                    WearReviewSubmissionFailureListItem(
                        message = submissionFailureMessage,
                        transformationSpec = transformationSpec
                    )
                }
            }
            content(transformationSpec)
        }
    }
}

/** Named where the language has a name for it, such as "tomorrow" or "now"; otherwise "in 5 minutes". */
private fun formatRelativeTime(timeMillis: Long, nowMillis: Long, locale: Locale, zoneId: ZoneId): String {
    val formatter = RelativeDateTimeFormatter.getInstance(
        ULocale.forLocale(locale),
        null,
        RelativeDateTimeFormatter.Style.LONG,
        DisplayContext.CAPITALIZATION_FOR_MIDDLE_OF_SENTENCE
    )
    val deltaMillis: Long = maxOf(timeMillis - nowMillis, 0L)
    // Under a day the rounded duration counts, so 59 min 40 s reads "in 1 hour" rather than "in 60 minutes".
    val clockUnit = clockRelativeTimeUnits.firstOrNull { candidate ->
        roundToUnits(deltaMillis = deltaMillis, unitMillis = candidate.unitMillis) * candidate.unitMillis < candidate.upperBoundMillis
    }
    if (clockUnit != null) {
        return formatter.format(roundToUnits(deltaMillis = deltaMillis, unitMillis = clockUnit.unitMillis).toDouble(), clockUnit.unit)
    }
    // From a day up, whole calendar units in the device time zone count.
    val today = Instant.ofEpochMilli(nowMillis).atZone(zoneId).toLocalDate()
    val dueDate = Instant.ofEpochMilli(nowMillis + deltaMillis).atZone(zoneId).toLocalDate()
    for (calendarUnit in calendarRelativeTimeUnits) {
        val count = calendarUnit.chronoUnit.between(today, dueDate)
        if (count > 0L) {
            return if (calendarUnit.namesDates) {
                formatter.format(count.toDouble(), calendarUnit.unit)
            } else {
                formatter.formatNumeric(count.toDouble(), calendarUnit.unit)
            }
        }
    }
    // A 25-hour daylight-saving day can hold a day's wait on one date.
    return formatter.format(
        roundToUnits(deltaMillis = deltaMillis, unitMillis = hourMillis).toDouble(),
        RelativeDateTimeFormatter.RelativeDateTimeUnit.HOUR
    )
}

private data class ClockRelativeTimeUnit(
    val unitMillis: Long,
    val unit: RelativeDateTimeFormatter.RelativeDateTimeUnit,
    /** Where the next unit takes over. */
    val upperBoundMillis: Long
)

private val clockRelativeTimeUnits: List<ClockRelativeTimeUnit> = listOf(
    ClockRelativeTimeUnit(unitMillis = 1_000L, unit = RelativeDateTimeFormatter.RelativeDateTimeUnit.SECOND, upperBoundMillis = minuteMillis),
    ClockRelativeTimeUnit(unitMillis = minuteMillis, unit = RelativeDateTimeFormatter.RelativeDateTimeUnit.MINUTE, upperBoundMillis = hourMillis),
    ClockRelativeTimeUnit(unitMillis = hourMillis, unit = RelativeDateTimeFormatter.RelativeDateTimeUnit.HOUR, upperBoundMillis = dayMillis)
)

private data class CalendarRelativeTimeUnit(
    val chronoUnit: ChronoUnit,
    val unit: RelativeDateTimeFormatter.RelativeDateTimeUnit,
    /**
     * Whether 1 and 2 may read as named dates such as "tomorrow". Only days: a named "next month" means the
     * next calendar month, which an elapsed count of months can miss (Jan 20 to Mar 10 is one month).
     */
    val namesDates: Boolean
)

/** Largest first, so the largest whole unit is the one shown. */
private val calendarRelativeTimeUnits: List<CalendarRelativeTimeUnit> = listOf(
    CalendarRelativeTimeUnit(chronoUnit = ChronoUnit.YEARS, unit = RelativeDateTimeFormatter.RelativeDateTimeUnit.YEAR, namesDates = false),
    CalendarRelativeTimeUnit(chronoUnit = ChronoUnit.MONTHS, unit = RelativeDateTimeFormatter.RelativeDateTimeUnit.MONTH, namesDates = false),
    CalendarRelativeTimeUnit(chronoUnit = ChronoUnit.WEEKS, unit = RelativeDateTimeFormatter.RelativeDateTimeUnit.WEEK, namesDates = false),
    CalendarRelativeTimeUnit(chronoUnit = ChronoUnit.DAYS, unit = RelativeDateTimeFormatter.RelativeDateTimeUnit.DAY, namesDates = true)
)

private fun roundToUnits(deltaMillis: Long, unitMillis: Long): Long {
    return (deltaMillis.toDouble() / unitMillis).roundToLong()
}
