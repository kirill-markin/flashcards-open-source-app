package com.flashcardsopensourceapp.feature.review

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.systemGestureExclusion
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp

/**
 * One line of whole tag chips that scrolls horizontally, so the card header height never changes and
 * no tag is hidden. The line runs on through the screen's end padding ([endBleed]), so chips scroll
 * to the screen edge and the last one rests on the content edge.
 */
@Composable
internal fun ReviewCardTagChipRow(
    tags: List<String>,
    spacing: Dp,
    endBleed: Dp,
    onRequestTagFilter: (String) -> Unit,
    modifier: Modifier
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(spacing),
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .layout { measurable, constraints ->
                val endBleedPx: Int = if (constraints.hasBoundedWidth) endBleed.roundToPx() else 0
                val placeable = measurable.measure(
                    constraints = constraints.copy(
                        minWidth = constraints.minWidth + endBleedPx,
                        maxWidth = constraints.maxWidth + endBleedPx
                    )
                )
                layout(width = placeable.width - endBleedPx, height = placeable.height) {
                    placeable.placeRelative(x = 0, y = 0)
                }
            }
            // The line reaches the screen edge, so a swipe there scrolls the chips instead of starting Back.
            .systemGestureExclusion()
            .horizontalScroll(state = rememberScrollState())
            .padding(end = endBleed)
    ) {
        tags.forEach { tag ->
            ReviewTagChip(
                tag = tag,
                onClick = {
                    onRequestTagFilter(tag)
                },
                modifier = Modifier.testTag(reviewCardTagChipTag(tag = tag))
            )
        }
    }
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
