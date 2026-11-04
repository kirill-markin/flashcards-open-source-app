package com.flashcardsopensourceapp.feature.review

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

private val reviewImageGallerySpacing = 8.dp

/** Image gallery grid; the layout rule is in docs/review-markdown-rendering.md. */
@Composable
internal fun <T> ReviewImageGallery(
    items: List<T>,
    itemContent: @Composable (T) -> Unit,
    modifier: Modifier
) {
    val columnCount: Int = reviewImageGalleryColumnCount(itemCount = items.size)
    Column(
        verticalArrangement = Arrangement.spacedBy(reviewImageGallerySpacing),
        modifier = modifier
    ) {
        items.chunked(size = columnCount).forEachIndexed { rowIndex, rowItems ->
            key(rowIndex) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(reviewImageGallerySpacing),
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    rowItems.forEachIndexed { columnIndex, item ->
                        key(columnIndex) {
                            Box(
                                contentAlignment = Alignment.Center,
                                modifier = Modifier.weight(weight = 1f)
                            ) {
                                itemContent(item)
                            }
                        }
                    }
                    repeat(times = columnCount - rowItems.size) {
                        Spacer(modifier = Modifier.weight(weight = 1f))
                    }
                }
            }
        }
    }
}

private fun reviewImageGalleryColumnCount(itemCount: Int): Int {
    require(itemCount > 1) {
        "An image gallery needs at least two images, got $itemCount."
    }
    return when (itemCount) {
        2, 4 -> 2
        else -> 3
    }
}
