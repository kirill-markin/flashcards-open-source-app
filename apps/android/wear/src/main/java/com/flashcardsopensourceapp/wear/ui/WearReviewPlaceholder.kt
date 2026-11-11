package com.flashcardsopensourceapp.wear.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.Text
import com.flashcardsopensourceapp.wear.R

/** Stands in for the signed-in Review screen until it lands. */
@Composable
fun WearReviewPlaceholder() {
    Box(modifier = Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.Center) {
        Text(text = stringResource(R.string.wear_review_placeholder), textAlign = TextAlign.Center)
    }
}
