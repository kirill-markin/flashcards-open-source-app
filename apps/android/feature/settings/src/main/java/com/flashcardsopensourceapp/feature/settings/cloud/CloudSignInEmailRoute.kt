package com.flashcardsopensourceapp.feature.settings.cloud

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding

const val cloudSignInEmailFieldTag: String = "cloud_sign_in_email_field"
const val cloudSignInSendCodeButtonTag: String = "cloud_sign_in_send_code_button"

@Composable
fun CloudSignInEmailRoute(
    uiState: CloudSignInUiState,
    onEmailChange: (String) -> Unit,
    onSendCode: () -> Unit,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = stringResource(R.string.settings_sign_in_title),
        onBack = onBack,
        isBackEnabled = uiState.isSendingCode.not()
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = if (uiState.isGuestUpgrade) {
                            stringResource(R.string.settings_sign_in_guest_upgrade_body)
                        } else {
                            stringResource(R.string.settings_sign_in_device_link_body)
                        },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(20.dp)
                    )
                }
            }

            if (uiState.errorMessage.isNotEmpty()) {
                item {
                    CloudSignInErrorCard(
                        message = uiState.errorMessage,
                        technicalDetails = uiState.errorTechnicalDetails,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }

            item {
                OutlinedTextField(
                    value = uiState.email,
                    onValueChange = onEmailChange,
                    label = {
                        Text(stringResource(R.string.settings_sign_in_email_title))
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag(tag = cloudSignInEmailFieldTag)
                )
            }

            item {
                Button(
                    onClick = onSendCode,
                    enabled = uiState.isSendingCode.not(),
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag(tag = cloudSignInSendCodeButtonTag)
                ) {
                    Text(
                        if (uiState.isSendingCode) {
                            stringResource(R.string.settings_sign_in_sending_code)
                        } else {
                            stringResource(R.string.settings_sign_in_send_code_button)
                        }
                    )
                }
            }
        }
    }
}
