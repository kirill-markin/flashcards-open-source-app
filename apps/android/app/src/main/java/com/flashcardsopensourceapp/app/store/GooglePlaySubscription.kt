package com.flashcardsopensourceapp.app.store

import android.content.Context
import android.util.Log
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClient.BillingResponseCode
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.queryProductDetails
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

private const val googlePlaySubscriptionLogTag: String = "GooglePlaySubscription"
private const val googlePlaySubscriptionProductId: String = "premium"

fun googlePlaySubscriptionManagementUrl(packageName: String): String {
    return "https://play.google.com/store/account/subscriptions?sku=$googlePlaySubscriptionProductId&package=$packageName"
}

/**
 * Whether Google Play returns product details for the subscription, which is what shows the Settings
 * subscription entry. The billing client connects for this one query and is released afterwards. A
 * billing error answers false, hiding the entry, and is logged with its error text.
 */
suspend fun loadIsGooglePlaySubscriptionProductAvailable(context: Context): Boolean {
    val billingClient: BillingClient = BillingClient.newBuilder(context.applicationContext)
        .setListener { billingResult, purchases ->
            // This client never launches a billing flow, so Play has no purchase update to deliver.
            Log.w(
                googlePlaySubscriptionLogTag,
                "event=google_play_unexpected_purchases_update ${renderBillingResultFields(billingResult = billingResult)} " +
                    "purchaseCount=${purchases?.size}"
            )
        }
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .build()
    try {
        val setupResult: BillingResult = startGooglePlayBillingConnection(billingClient = billingClient)
        if (setupResult.responseCode != BillingResponseCode.OK) {
            logGooglePlayBillingError(event = "google_play_billing_setup_failed", billingResult = setupResult)
            return false
        }

        val productDetailsResult = billingClient.queryProductDetails(
            QueryProductDetailsParams.newBuilder()
                .setProductList(
                    listOf(
                        QueryProductDetailsParams.Product.newBuilder()
                            .setProductId(googlePlaySubscriptionProductId)
                            .setProductType(BillingClient.ProductType.SUBS)
                            .build()
                    )
                )
                .build()
        )
        if (productDetailsResult.billingResult.responseCode != BillingResponseCode.OK) {
            logGooglePlayBillingError(
                event = "google_play_subscription_product_query_failed",
                billingResult = productDetailsResult.billingResult
            )
            return false
        }
        // An empty answer is the expected state until the product exists in Play Console.
        return productDetailsResult.productDetailsList.orEmpty().any { productDetails ->
            productDetails.productId == googlePlaySubscriptionProductId
        }
    } finally {
        billingClient.endConnection()
    }
}

private suspend fun startGooglePlayBillingConnection(billingClient: BillingClient): BillingResult {
    return suspendCancellableCoroutine { continuation ->
        billingClient.startConnection(
            object : BillingClientStateListener {
                override fun onBillingSetupFinished(billingResult: BillingResult) {
                    if (continuation.isActive) {
                        continuation.resume(billingResult)
                    }
                }

                override fun onBillingServiceDisconnected() {
                    if (continuation.isActive) {
                        continuation.resume(
                            BillingResult.newBuilder()
                                .setResponseCode(BillingResponseCode.SERVICE_DISCONNECTED)
                                .setDebugMessage("Google Play Billing service disconnected before setup finished.")
                                .build()
                        )
                    }
                }
            }
        )
    }
}

private fun logGooglePlayBillingError(event: String, billingResult: BillingResult) {
    Log.w(
        googlePlaySubscriptionLogTag,
        "event=$event productId=$googlePlaySubscriptionProductId ${renderBillingResultFields(billingResult = billingResult)}"
    )
}

private fun renderBillingResultFields(billingResult: BillingResult): String {
    return "responseCode=${billingResult.responseCode} debugMessage=${billingResult.debugMessage}"
}
