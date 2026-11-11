package com.flashcardsopensourceapp.feature.settings.workspace.tags

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.feature.settings.OverviewRow
import com.flashcardsopensourceapp.feature.settings.R

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkspaceTagDetailRoute(
    tag: String,
    stats: WorkspaceTagDetailStats?,
    onOpenReview: () -> Unit,
    onResetProgress: () -> Unit,
    onRemoveTag: () -> Unit,
    onBack: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(text = tag, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = stringResource(R.string.settings_back_content_description)
                        )
                    }
                }
            )
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            if (stats == null) {
                CircularProgressIndicator()
                return@Column
            }
            if (stats.totalCards == 0) {
                Text(stringResource(R.string.settings_tag_detail_unavailable))
                return@Column
            }

            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(text = tag, style = MaterialTheme.typography.headlineSmall)
                    OverviewRow(title = stringResource(R.string.settings_tag_detail_total), value = stats.totalCards)
                    OverviewRow(title = stringResource(R.string.settings_workspace_new_title), value = stats.newCards)
                    OverviewRow(title = stringResource(R.string.settings_workspace_to_study_title), value = stats.dueCards)
                }
            }
            Button(
                onClick = onOpenReview,
                modifier = Modifier.fillMaxWidth().testTag("workspace_tag_detail_review")
            ) {
                Text(stringResource(R.string.settings_tag_detail_open_review))
            }
            OutlinedButton(
                onClick = onResetProgress,
                modifier = Modifier.fillMaxWidth().testTag("workspace_tag_detail_reset_progress")
            ) {
                Text(stringResource(R.string.settings_reset_study_progress_title))
            }
            OutlinedButton(
                onClick = onRemoveTag,
                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                modifier = Modifier.fillMaxWidth().testTag("workspace_tag_detail_remove")
            ) {
                Text(stringResource(R.string.settings_tag_detail_remove_tag))
            }
        }
    }
}
