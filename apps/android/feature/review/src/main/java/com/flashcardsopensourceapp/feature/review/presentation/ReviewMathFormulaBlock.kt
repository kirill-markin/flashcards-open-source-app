package com.flashcardsopensourceapp.feature.review

import android.util.Log
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import io.ratex.RaTeXException
import io.ratex.RaTeXView

private const val reviewMathLogTag: String = "ReviewMath"
private val reviewMathBlockCornerRadius = 12.dp
private val reviewMathMinimumHeight = 32.dp

@Composable
internal fun ReviewMathFormulaBlock(
    source: String,
    delimitedSource: String,
    modifier: Modifier
) {
    var renderError: RaTeXException? by remember(source) {
        mutableStateOf<RaTeXException?>(value = null)
    }
    val errorMessage: String = stringResource(id = R.string.review_math_render_failed)
    val formulaColor: Int = MaterialTheme.colorScheme.onSurface.toArgb()
    val formulaFontSize: TextUnit = MaterialTheme.typography.bodyLarge.fontSize
    val localDensity: Density = LocalDensity.current
    val formulaFontSizeDp: Float = with(localDensity) {
        formulaFontSize.toPx() / density
    }
    val onRenderError: (RaTeXException) -> Unit = { error ->
        Log.e(reviewMathLogTag, "RaTeX formula rendering failed.", error)
        renderError = error
    }

    Surface(
        color = MaterialTheme.colorScheme.surfaceContainer,
        shape = RoundedCornerShape(reviewMathBlockCornerRadius),
        modifier = modifier.fillMaxWidth()
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clearAndSetSemantics {
                    contentDescription = source
                    if (renderError != null) {
                        stateDescription = errorMessage
                    }
                }
        ) {
            if (renderError != null) {
                ReviewMathRenderError(
                    delimitedSource = delimitedSource,
                    errorMessage = errorMessage
                )
            } else {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(state = rememberScrollState())
                        .padding(horizontal = 12.dp, vertical = 6.dp)
                ) {
                    AndroidView(
                        factory = { context -> RaTeXView(context) },
                        update = { view ->
                            view.displayMode = true
                            view.fontSize = formulaFontSizeDp
                            view.color = formulaColor
                            view.onError = onRenderError
                            view.latex = source
                        },
                        modifier = Modifier
                            .heightIn(min = reviewMathMinimumHeight)
                            .wrapContentSize()
                    )
                }
            }
        }
    }
}

@Composable
private fun ReviewMathRenderError(
    delimitedSource: String,
    errorMessage: String
) {
    Column(
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(state = rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 12.dp)
    ) {
        Text(
            text = delimitedSource,
            style = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace)
        )
        Text(
            text = errorMessage,
            color = MaterialTheme.colorScheme.error,
            style = MaterialTheme.typography.bodyMedium
        )
    }
}
