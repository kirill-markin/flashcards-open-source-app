package com.flashcardsopensourceapp.feature.review

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.AssistChip
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Placeable
import androidx.compose.ui.layout.SubcomposeLayout
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp

private sealed interface ReviewTagChipRowSlot {
    data object MeasuredTags : ReviewTagChipRowSlot
    data class MeasuredOverflow(val hiddenCount: Int) : ReviewTagChipRowSlot
    data object VisibleContent : ReviewTagChipRowSlot
}

/**
 * One line of whole tag chips: tags that do not fit move into a trailing "+N" chip whose menu
 * offers them, so the card header height never changes and no tag is clipped or hidden silently.
 */
@Composable
internal fun ReviewCardTagChipRow(
    tags: List<String>,
    spacing: Dp,
    onRequestTagFilter: (String) -> Unit,
    modifier: Modifier
) {
    var isOverflowMenuExpanded by remember { mutableStateOf(false) }

    SubcomposeLayout(modifier = modifier) { constraints ->
        val maxWidth: Int = constraints.maxWidth
        val spacingPx: Int = spacing.roundToPx()
        val looseConstraints = Constraints(maxWidth = maxWidth, maxHeight = constraints.maxHeight)
        val tagWidths: List<Int> = subcompose(slotId = ReviewTagChipRowSlot.MeasuredTags) {
            tags.forEach { tag ->
                ReviewTagChip(tag = tag, onClick = {}, modifier = Modifier.clearAndSetSemantics {})
            }
        }.map { measurable ->
            measurable.measure(constraints = looseConstraints).width
        }
        // A slot can be subcomposed only once per pass, so each "+N" width is measured once.
        val overflowWidths: MutableMap<Int, Int> = mutableMapOf()
        val measureOverflowWidth: (Int) -> Int = { hiddenCount ->
            overflowWidths.getOrPut(key = hiddenCount) {
                subcompose(slotId = ReviewTagChipRowSlot.MeasuredOverflow(hiddenCount = hiddenCount)) {
                    ReviewTagOverflowChip(
                        hiddenCount = hiddenCount,
                        onClick = {},
                        modifier = Modifier.clearAndSetSemantics {}
                    )
                }.single().measure(constraints = looseConstraints).width
            }
        }
        val visibleCount: Int = reviewVisibleTagChipCount(
            tagWidths = tagWidths,
            spacingPx = spacingPx,
            maxWidth = maxWidth,
            measureOverflowWidth = measureOverflowWidth
        )
        val hiddenTags: List<String> = tags.drop(n = visibleCount)
        val visibleContent = subcompose(slotId = ReviewTagChipRowSlot.VisibleContent) {
            tags.take(n = visibleCount).forEach { tag ->
                ReviewTagChip(
                    tag = tag,
                    onClick = {
                        onRequestTagFilter(tag)
                    },
                    modifier = Modifier.testTag(reviewCardTagChipTag(tag = tag))
                )
            }
            if (hiddenTags.isNotEmpty()) {
                Box {
                    ReviewTagOverflowChip(
                        hiddenCount = hiddenTags.size,
                        onClick = {
                            isOverflowMenuExpanded = true
                        },
                        modifier = Modifier.testTag(reviewCardTagOverflowChipTag)
                    )
                    DropdownMenu(
                        expanded = isOverflowMenuExpanded,
                        onDismissRequest = {
                            isOverflowMenuExpanded = false
                        }
                    ) {
                        hiddenTags.forEach { tag ->
                            DropdownMenuItem(
                                text = {
                                    Text(text = tag)
                                },
                                onClick = {
                                    isOverflowMenuExpanded = false
                                    onRequestTagFilter(tag)
                                },
                                modifier = Modifier.testTag(reviewCardTagOverflowMenuItemTag(tag = tag))
                            )
                        }
                    }
                }
            }
        }
        val overflowWidth: Int = if (hiddenTags.isEmpty()) 0 else spacingPx + measureOverflowWidth(hiddenTags.size)
        // A lone first chip may be wider than the line; narrowing it ellipsizes its label instead of cutting the chip.
        val firstChipMaxWidth: Int = (maxWidth - overflowWidth).coerceAtLeast(minimumValue = 0)
        val placeables: List<Placeable> = visibleContent.mapIndexed { index, measurable ->
            val chipConstraints = if (index == 0 && visibleCount == 1) {
                Constraints(maxWidth = firstChipMaxWidth, maxHeight = constraints.maxHeight)
            } else {
                looseConstraints
            }
            measurable.measure(constraints = chipConstraints)
        }
        val rowWidth: Int = placeables.sumOf(Placeable::width) + spacingPx * (placeables.size - 1).coerceAtLeast(0)
        val rowHeight: Int = placeables.maxOfOrNull(Placeable::height) ?: 0

        layout(width = rowWidth.coerceAtMost(maximumValue = maxWidth), height = rowHeight) {
            var x = 0
            placeables.forEach { placeable ->
                placeable.placeRelative(
                    x = x,
                    y = Alignment.CenterVertically.align(size = placeable.height, space = rowHeight)
                )
                x += placeable.width + spacingPx
            }
        }
    }
}

/** At least one tag chip stays visible; the rest fit greedily in order, leaving room for "+N". */
private fun reviewVisibleTagChipCount(
    tagWidths: List<Int>,
    spacingPx: Int,
    maxWidth: Int,
    measureOverflowWidth: (Int) -> Int
): Int {
    for (visibleCount in tagWidths.size downTo 1) {
        val hiddenCount: Int = tagWidths.size - visibleCount
        val chipsWidth: Int = tagWidths.take(n = visibleCount).sum() + spacingPx * (visibleCount - 1)
        val overflowWidth: Int = if (hiddenCount == 0) 0 else spacingPx + measureOverflowWidth(hiddenCount)
        if (chipsWidth + overflowWidth <= maxWidth) {
            return visibleCount
        }
    }
    return 1
}

@Composable
private fun ReviewTagChip(
    tag: String,
    onClick: () -> Unit,
    modifier: Modifier
) {
    val changeFilterClickLabel = stringResource(id = R.string.review_tag_chip_click_label)

    AssistChip(
        onClick = onClick,
        label = {
            Text(
                text = tag,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        },
        modifier = modifier.semantics {
            onClick(label = changeFilterClickLabel) {
                onClick()
                true
            }
        }
    )
}

@Composable
private fun ReviewTagOverflowChip(
    hiddenCount: Int,
    onClick: () -> Unit,
    modifier: Modifier
) {
    val overflowContentDescription = pluralStringResource(
        id = R.plurals.review_tag_overflow_content_description,
        count = hiddenCount,
        hiddenCount
    )

    AssistChip(
        onClick = onClick,
        label = {
            Text(
                text = stringResource(id = R.string.review_tag_overflow_label, hiddenCount),
                maxLines = 1
            )
        },
        modifier = modifier.semantics {
            contentDescription = overflowContentDescription
        }
    )
}
