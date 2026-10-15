package com.flashcardsopensourceapp.feature.settings.cloud.signIn

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
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding

@Composable
fun CloudSignInCodeRoute(
    uiState: CloudSignInUiState,
    onShown: () -> Unit,
    onCodeChange: (String) -> Unit,
    onVerifyCode: () -> Unit,
    onShowTechnicalDetails: (String, String) -> Unit,
    onBack: () -> Unit
) {
    LaunchedEffect(Unit) { onShown() }
    SettingsScreenScaffold(
        title = stringResource(R.string.settings_sign_in_verify_title),
        onBack = onBack,
        isBackEnabled = uiState.isVerifyingCode.not()
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
                            stringResource(
                                R.string.settings_sign_in_verify_guest_body,
                                uiState.challengeEmail ?: stringResource(R.string.settings_sign_in_email_fallback)
                            )
                        } else {
                            stringResource(
                                R.string.settings_sign_in_verify_body,
                                uiState.challengeEmail ?: stringResource(R.string.settings_sign_in_email_fallback)
                            )
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
                        technicalDetailsReportId = uiState.errorTechnicalDetailsReportId,
                        modifier = Modifier.fillMaxWidth(),
                        onShowTechnicalDetails = onShowTechnicalDetails
                    )
                }
            }

            item {
                OutlinedTextField(
                    value = uiState.code,
                    enabled = !uiState.isVerifyingCode,
                    onValueChange = { onCodeChange(it.filter { character -> character in '0'..'9' }.take(8)) },
                    label = {
                        Text(stringResource(R.string.settings_sign_in_code_label))
                    },
                    modifier = Modifier.fillMaxWidth().testTag("cloud_sign_in_code_field")
                )
            }

            item {
                Button(
                    onClick = onVerifyCode,
                    enabled = !uiState.isVerifyingCode && uiState.challengeEmail != null && uiState.code.length == 8,
                    modifier = Modifier.fillMaxWidth().testTag("cloud_sign_in_verify_button")
                ) {
                    Text(
                        if (uiState.isVerifyingCode) {
                            stringResource(R.string.settings_sign_in_verifying)
                        } else {
                            stringResource(R.string.settings_sign_in_verify_button)
                        }
                    )
                }
            }
            item {
                TextButton(onClick = onBack, enabled = !uiState.isVerifyingCode,
                    modifier = Modifier.testTag("cloud_sign_in_new_code")) {
                    Text(stringResource(R.string.settings_auth_new_email_code))
                }
            }
        }
    }
}
