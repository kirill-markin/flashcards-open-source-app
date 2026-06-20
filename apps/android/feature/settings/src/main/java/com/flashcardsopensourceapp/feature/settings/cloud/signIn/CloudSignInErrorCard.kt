package com.flashcardsopensourceapp.feature.settings.cloud.signIn

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.feature.settings.R

@Composable
fun CloudSignInErrorCard(
    message: String,
    technicalDetails: String?,
    technicalDetailsReportId: String?,
    modifier: Modifier,
    onShowTechnicalDetails: (String, String) -> Unit
) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.errorContainer
        )
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(20.dp)
        ) {
            Text(
                text = message,
                color = MaterialTheme.colorScheme.onErrorContainer
            )

            if (technicalDetails.isNullOrBlank().not() && technicalDetailsReportId.isNullOrBlank().not()) {
                TextButton(
                    onClick = {
                        onShowTechnicalDetails(
                            technicalDetails.orEmpty(),
                            technicalDetailsReportId.orEmpty()
                        )
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = stringResource(R.string.settings_sign_in_error_show_details)
                    )
                }
            }
        }
    }
}
