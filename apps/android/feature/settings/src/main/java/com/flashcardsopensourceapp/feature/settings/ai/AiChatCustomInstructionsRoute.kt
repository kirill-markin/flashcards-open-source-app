package com.flashcardsopensourceapp.feature.settings.ai

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding

const val aiChatCustomInstructionsScreenTag: String = "ai_chat_custom_instructions_screen"
const val aiChatCustomInstructionsFieldTag: String = "ai_chat_custom_instructions_field"
const val aiChatCustomInstructionsSaveButtonTag: String = "ai_chat_custom_instructions_save_button"
const val aiChatCustomInstructionsRetryButtonTag: String = "ai_chat_custom_instructions_retry_button"
const val aiChatCustomInstructionsSaveErrorTag: String = "ai_chat_custom_instructions_save_error"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiChatCustomInstructionsRoute(
    uiState: AiChatCustomInstructionsUiState,
    onRetryLoad: () -> Unit,
    onSave: (String) -> Unit,
    onSaved: () -> Unit,
    onBack: () -> Unit
) {
    val loaded = uiState.loadState as? AiChatCustomInstructionsLoadState.Loaded
    // The field owns its text so keystrokes never wait on a flow; it restarts from the saved text once loaded.
    // The saved-state key carries the scope, so a draft restored on return never lands in another workspace.
    var draft by rememberSaveable(
        loaded?.scopeId,
        loaded?.canEdit,
        stateSaver = TextFieldValue.Saver,
        key = "ai_chat_custom_instructions_draft::${loaded?.scopeId}"
    ) {
        val savedText = loaded?.savedText.orEmpty()
        mutableStateOf(value = TextFieldValue(text = savedText, selection = TextRange(index = savedText.length)))
    }
    val editedText = draft.text.trim()
    val characterCount = editedText.codePointCount(0, editedText.length)
    val isOverLimit = loaded != null && characterCount > loaded.maxLength
    val canSave = loaded?.canEdit == true && uiState.isSaving.not() && isOverLimit.not() && editedText != loaded.savedText
    val focusRequester = remember { FocusRequester() }

    BackHandler(enabled = uiState.isSaving) {}

    LaunchedEffect(uiState.didSave) {
        if (uiState.didSave) {
            onSaved()
        }
    }

    LaunchedEffect(loaded?.scopeId, loaded?.canEdit) {
        if (loaded?.canEdit == true) {
            focusRequester.requestFocus()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(stringResource(R.string.ai_chat_instructions_title))
                },
                navigationIcon = {
                    IconButton(
                        onClick = onBack,
                        enabled = uiState.isSaving.not()
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = stringResource(R.string.settings_back_content_description)
                        )
                    }
                },
                actions = {
                    if (uiState.isSaving) {
                        CircularProgressIndicator(
                            modifier = Modifier
                                .padding(horizontal = 24.dp)
                                .size(24.dp)
                        )
                    } else if (loaded?.canEdit == true) {
                        TextButton(
                            onClick = { onSave(editedText) },
                            enabled = canSave,
                            modifier = Modifier.testTag(tag = aiChatCustomInstructionsSaveButtonTag)
                        ) {
                            Text(stringResource(R.string.settings_save))
                        }
                    }
                }
            )
        }
    ) { innerPadding ->
        Column(
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier
                .fillMaxSize()
                .consumeWindowInsets(innerPadding)
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(settingsScreenContentPadding(innerPadding = innerPadding))
                .testTag(tag = aiChatCustomInstructionsScreenTag)
        ) {
            Text(
                text = stringResource(R.string.ai_chat_instructions_description),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium
            )
            OutlinedTextField(
                value = if (loaded?.canEdit == false) TextFieldValue(loaded.savedText) else draft,
                onValueChange = { text -> draft = text },
                placeholder = {
                    if (loaded?.canEdit == true) {
                        Text(stringResource(R.string.ai_chat_instructions_placeholder))
                    }
                },
                supportingText = {
                    if (loaded == null) {
                        if (uiState.loadState == AiChatCustomInstructionsLoadState.Loading) {
                            Box(contentAlignment = Alignment.CenterEnd, modifier = Modifier.fillMaxWidth()) {
                                CircularProgressIndicator(
                                    strokeWidth = 2.dp,
                                    modifier = Modifier.size(16.dp)
                                )
                            }
                        }
                    } else if (loaded.canEdit) {
                        Text(
                            text = stringResource(
                                R.string.ai_chat_instructions_count,
                                characterCount,
                                loaded.maxLength
                            ),
                            modifier = Modifier.fillMaxWidth(),
                            textAlign = TextAlign.End
                        )
                    }
                },
                isError = isOverLimit,
                enabled = loaded != null && uiState.isSaving.not(),
                readOnly = loaded?.canEdit != true,
                minLines = 6,
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(focusRequester)
                    .testTag(tag = aiChatCustomInstructionsFieldTag)
            )

            if (loaded?.canEdit == true && loaded.savedText.isNotEmpty()) {
                TextButton(onClick = { onSave("") }, enabled = uiState.isSaving.not()) {
                    Text(
                        text = stringResource(R.string.settings_delete),
                        color = MaterialTheme.colorScheme.error
                    )
                }
            }

            val loadState = uiState.loadState
            if (loadState is AiChatCustomInstructionsLoadState.Failed) {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.padding(20.dp)
                    ) {
                        Text(stringResource(R.string.ai_chat_instructions_load_failed))
                        if (loadState.technicalDetails.isNotEmpty()) {
                            Text(
                                text = loadState.technicalDetails,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        OutlinedButton(
                            onClick = onRetryLoad,
                            modifier = Modifier.testTag(tag = aiChatCustomInstructionsRetryButtonTag)
                        ) {
                            Text(stringResource(R.string.settings_retry))
                        }
                    }
                }
            }

            val saveErrorDetails = uiState.saveErrorDetails
            if (saveErrorDetails != null) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier.testTag(tag = aiChatCustomInstructionsSaveErrorTag)
                ) {
                    Text(
                        text = stringResource(R.string.ai_chat_instructions_save_failed),
                        color = MaterialTheme.colorScheme.error
                    )
                    if (saveErrorDetails.isNotEmpty()) {
                        Text(
                            text = saveErrorDetails,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
    }
}
