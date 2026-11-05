package com.flashcardsopensourceapp.feature.ai.ui

import android.icu.text.MeasureFormat
import android.icu.util.Measure
import android.icu.util.MeasureUnit
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.core.ui.currentResourceLocale
import com.flashcardsopensourceapp.data.local.model.ai.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.ai.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.ai.AiChatToolCallStatus
import com.flashcardsopensourceapp.data.local.model.ai.aiChatOptimisticAssistantStatusToken
import com.flashcardsopensourceapp.feature.ai.R
import com.flashcardsopensourceapp.feature.ai.aiWorkBlockTag
import com.flashcardsopensourceapp.feature.ai.aiWorkBlockToggleTag
import com.flashcardsopensourceapp.feature.ai.toolcall.AiTranscriptDisclosureRow
import kotlinx.coroutines.delay
import java.util.Locale

private const val aiWorkBlockTickMillis: Long = 1_000L
private const val secondsPerMinute: Long = 60L
private const val secondsPerHour: Long = 3_600L

/** An assistant message split after its last tool call or reasoning step. */
internal data class AiAssistantMessageSections(
    val workParts: List<AiChatContentPart>,
    val answerParts: List<AiChatContentPart>
)

/** Null when the message has no tool call or reasoning step, so it renders without a work block. */
internal fun splitAssistantMessageSections(content: List<AiChatContentPart>): AiAssistantMessageSections? {
    val lastWorkIndex = content.indexOfLast { part ->
        part is AiChatContentPart.ToolCall || part is AiChatContentPart.ReasoningSummary
    }
    if (lastWorkIndex < 0) {
        return null
    }
    return AiAssistantMessageSections(
        workParts = content.subList(fromIndex = 0, toIndex = lastWorkIndex + 1),
        answerParts = content.subList(fromIndex = lastWorkIndex + 1, toIndex = content.size)
    )
}

/** Open while the run works, and afterwards whenever the answer alone cannot stand for the reply. */
private fun isWorkBlockAutoExpanded(
    isRunActive: Boolean,
    isStopped: Boolean,
    isError: Boolean,
    answerParts: List<AiChatContentPart>
): Boolean {
    if (isRunActive || isStopped || isError) {
        return true
    }
    return answerParts.none { part ->
        part is AiChatContentPart.Text &&
            part.text != aiChatOptimisticAssistantStatusToken &&
            part.text.isNotBlank()
    }
}

/** Whole seconds with abbreviated units: `22s`, `1m 5s`, `1h 3m`. */
private fun formatAiWorkDuration(durationMillis: Long, locale: Locale): String {
    val totalSeconds = durationMillis.coerceAtLeast(minimumValue = 0L) / 1_000L
    val hours = totalSeconds / secondsPerHour
    val minutes = totalSeconds % secondsPerHour / secondsPerMinute
    val seconds = totalSeconds % secondsPerMinute
    val measures = when {
        totalSeconds < secondsPerMinute -> arrayOf(Measure(seconds, MeasureUnit.SECOND))
        totalSeconds < secondsPerHour -> arrayOf(
            Measure(minutes, MeasureUnit.MINUTE),
            Measure(seconds, MeasureUnit.SECOND)
        )
        else -> arrayOf(
            Measure(hours, MeasureUnit.HOUR),
            Measure(minutes, MeasureUnit.MINUTE)
        )
    }
    return MeasureFormat.getInstance(locale, MeasureFormat.FormatWidth.NARROW).formatMeasures(*measures)
}

/**
 * The disclosure block holding an assistant message's work parts. The automatic open state
 * applies only when it changes, so a manual toggle survives recomposition and scrolling.
 */
@Composable
internal fun AiWorkBlock(
    message: AiChatMessage,
    sections: AiAssistantMessageSections,
    isRunActive: Boolean,
    workPartContent: @Composable (AiChatContentPart) -> Unit,
    modifier: Modifier
) {
    val autoExpanded = isWorkBlockAutoExpanded(
        isRunActive = isRunActive,
        isStopped = message.isStopped,
        isError = message.isError,
        answerParts = sections.answerParts
    )
    var isExpanded by rememberSaveable(message.messageId) {
        mutableStateOf(value = autoExpanded)
    }
    var appliedAutoExpanded by rememberSaveable(message.messageId) {
        mutableStateOf(value = autoExpanded)
    }
    LaunchedEffect(autoExpanded) {
        if (appliedAutoExpanded != autoExpanded) {
            appliedAutoExpanded = autoExpanded
            isExpanded = autoExpanded
        }
    }

    Column(
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = modifier.testTag(tag = aiWorkBlockTag)
    ) {
        Column {
            AiWorkBlockHeader(
                timestampMillis = message.timestampMillis,
                completedAtMillis = message.completedAtMillis,
                isRunActive = isRunActive,
                isExpanded = isExpanded,
                onToggle = {
                    isExpanded = isExpanded.not()
                }
            )
            HorizontalDivider()
        }
        if (isExpanded) {
            sections.workParts.forEach { part ->
                workPartContent(part)
            }
            HorizontalDivider()
        }
    }
}

@Composable
private fun AiWorkBlockHeader(
    timestampMillis: Long,
    completedAtMillis: Long?,
    isRunActive: Boolean,
    isExpanded: Boolean,
    onToggle: () -> Unit
) {
    val locale = currentResourceLocale(resources = LocalResources.current)
    var nowMillis by remember { mutableLongStateOf(value = System.currentTimeMillis()) }
    LaunchedEffect(isRunActive, timestampMillis) {
        while (isRunActive) {
            nowMillis = System.currentTimeMillis()
            // Wake on the next whole second of the elapsed time, so the label never skips a value.
            delay(timeMillis = aiWorkBlockTickMillis - (nowMillis - timestampMillis).mod(aiWorkBlockTickMillis))
        }
    }
    val label = when {
        isRunActive -> stringResource(
            id = R.string.ai_work_block_working_for,
            formatAiWorkDuration(durationMillis = nowMillis - timestampMillis, locale = locale)
        )

        completedAtMillis != null -> stringResource(
            id = R.string.ai_work_block_worked_for,
            formatAiWorkDuration(durationMillis = completedAtMillis - timestampMillis, locale = locale)
        )

        else -> stringResource(id = R.string.ai_work_block_worked)
    }

    AiTranscriptDisclosureRow(
        label = label,
        status = if (isRunActive) AiChatToolCallStatus.STARTED else AiChatToolCallStatus.COMPLETED,
        isExpanded = isExpanded,
        onClickLabel = null,
        onToggle = onToggle,
        labelModifier = Modifier,
        statusModifier = Modifier,
        modifier = Modifier.testTag(tag = aiWorkBlockToggleTag)
    )
}
