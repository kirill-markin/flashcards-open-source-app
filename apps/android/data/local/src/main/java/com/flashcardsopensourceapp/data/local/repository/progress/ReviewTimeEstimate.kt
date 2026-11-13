package com.flashcardsopensourceapp.data.local.repository.progress

import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressInsights
import java.time.LocalDate
import kotlin.math.roundToInt

// Port of the minute helpers in apps/web/src/screens/progress/records/progressInsightsModel.ts.

/** Rounded minutes for [seconds], never "≈ 0 min" for real work. */
fun roundStudyMinutes(seconds: Double): Int {
    return if (seconds <= 0.0) 0 else maxOf(1, (seconds / 60.0).roundToInt())
}

/**
 * The one multiplication a client does with server timing: due cards × seconds per due card. Null at
 * 0 due and without the server's timing sample.
 */
fun estimateDueMinutes(dueCount: Int, insights: CloudProgressInsights?): Int? {
    val secondsPerDueCard: Double = insights?.secondsPerDueCard ?: return null
    if (dueCount <= 0) {
        return null
    }
    return roundStudyMinutes(seconds = dueCount * secondsPerDueCard)
}

/** Study seconds over the server's last 7 local days; null without the timing sample. */
fun calculateLast7DaysStudySeconds(insights: CloudProgressInsights?): Int? {
    return insights?.studySecondsByDay?.sumOf { day -> day.seconds }
}

/** Study seconds on [date]; null without the timing sample, 0 for a day the server did not list. */
fun calculateStudySecondsOnDate(insights: CloudProgressInsights?, date: LocalDate): Int? {
    val days = insights?.studySecondsByDay ?: return null
    val rawDate: String = date.toString()
    return days.firstOrNull { day -> day.date == rawDate }?.seconds ?: 0
}
