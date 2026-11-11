package com.flashcardsopensourceapp.wear.ui

import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.wear.compose.foundation.lazy.TransformingLazyColumnItemScope
import androidx.wear.compose.material3.lazy.TransformationSpec
import androidx.wear.compose.material3.lazy.transformedHeight

/** For a list item without a surface, such as text, which morphs as a whole near the round edges. */
fun Modifier.transformedListItem(
    itemScope: TransformingLazyColumnItemScope,
    transformationSpec: TransformationSpec
): Modifier {
    return this
        .transformedHeight(itemScope, transformationSpec)
        .graphicsLayer {
            with(transformationSpec) {
                applyContainerTransformation(with(itemScope) { scrollProgress })
            }
        }
}
