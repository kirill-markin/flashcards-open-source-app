package com.flashcardsopensourceapp.feature.progress.sections

import android.icu.text.DateIntervalFormat
import android.icu.util.DateInterval
import android.icu.util.TimeZone
import android.text.format.DateFormat
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.feature.progress.ProgressRecordsSectionUiState
import com.flashcardsopensourceapp.feature.progress.R
import java.text.NumberFormat
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Personal bests and plain counts; never a grade. */
@Composable
internal fun RecordsSectionCard(
    uiState: ProgressRecordsSectionUiState
) {
    val locale = LocalConfiguration.current.locales[0]
    val countFormatter = remember(locale) {
        NumberFormat.getIntegerInstance(locale)
    }
    val dayFormatter = remember(locale) {
        DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, "MMMd"), locale)
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .testTag(progressRecordsSectionTag),
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
                text = stringResource(id = R.string.progress_records_title),
                style = MaterialTheme.typography.titleLarge
            )
            val bestDay = uiState.bestDay
            if (bestDay != null) {
                RecordRow(
                    label = stringResource(id = R.string.progress_records_best_day),
                    value = countFormatter.format(bestDay.reviewCount.toLong()),
                    detail = dayFormatter.format(bestDay.date)
                )
            }
            val bestWeek = uiState.bestWeek
            if (bestWeek != null) {
                RecordRow(
                    label = stringResource(id = R.string.progress_records_best_week),
                    value = countFormatter.format(bestWeek.reviewCount.toLong()),
                    detail = formatRecordWeekRange(endDate = bestWeek.date, locale = locale)
                )
            }
            RecordRow(
                label = stringResource(id = R.string.progress_records_longest_streak),
                value = pluralStringResource(
                    id = R.plurals.progress_streak_leaderboard_day_count,
                    count = uiState.longestStreakDays,
                    countFormatter.format(uiState.longestStreakDays.toLong())
                ),
                detail = null
            )
            RecordRow(
                label = stringResource(id = R.string.progress_records_total_reviews),
                value = countFormatter.format(uiState.totalReviews.toLong()),
                detail = null
            )
            Text(
                text = stringResource(id = R.string.progress_records_last_7_days),
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.padding(top = 4.dp)
            )
            RecordRow(
                label = stringResource(id = R.string.progress_records_cards_met),
                value = countFormatter.format(uiState.cardsMetLast7Days.toLong()),
                detail = null
            )
            RecordRow(
                label = stringResource(id = R.string.progress_records_relearned),
                value = countFormatter.format(uiState.relearnedLast7Days.toLong()),
                detail = null
            )
        }
    }
}

@Composable
private fun RecordRow(label: String, value: String, detail: String?) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth()
    ) {
        Text(
            text = label,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.weight(1f)
        )
        Spacer(modifier = Modifier.width(12.dp))
        Text(
            text = value,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.End
        )
        if (detail != null) {
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = detail,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium
            )
        }
    }
}

/** The rolling 7 local days ending [endDate]. */
private fun formatRecordWeekRange(endDate: LocalDate, locale: Locale): String {
    val formatter = DateIntervalFormat.getInstance("MMMd", locale).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }
    return formatter.format(
        DateInterval(
            endDate.minusDays(6L).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli(),
            endDate.atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli()
        )
    )
}
