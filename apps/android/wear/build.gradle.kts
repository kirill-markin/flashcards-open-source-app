import com.android.build.api.dsl.ApplicationExtension
import org.gradle.api.GradleException

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// The watch ships with the phone under one Play listing, so it takes the phone's version name and
// language list from `:app` instead of keeping copies.
evaluationDependsOn(":app")
val phoneProject: Project = project(":app")
val phoneVersionName: String = requireNotNull(
    phoneProject.extensions.getByType(ApplicationExtension::class.java).defaultConfig.versionName
) {
    "apps/android/app/build.gradle.kts must set defaultConfig.versionName."
}
@Suppress("UNCHECKED_CAST")
val phoneLocaleFilters: List<String> = phoneProject.extra["supportedAndroidLocaleFilters"] as List<String>

// A task path without a project runs in every project, `:wear` included; `:app:` release tasks do not.
val isWearReleaseTaskRequested: Boolean = gradle.startParameter.taskNames.any { taskName ->
    val taskPath = taskName.removePrefix(":")
    taskPath.contains("Release", ignoreCase = true) &&
        (taskPath.contains(":").not() || taskPath.startsWith("wear:"))
}
val androidWearVersionCode: Int? = providers.environmentVariable("ANDROID_WEAR_VERSION_CODE").orNull?.toIntOrNull()
val androidReleaseStoreFile: String? = providers.environmentVariable("ANDROID_RELEASE_STORE_FILE").orNull
val androidReleaseStorePassword: String? = providers.environmentVariable("ANDROID_RELEASE_STORE_PASSWORD").orNull
val androidReleaseKeyAlias: String? = providers.environmentVariable("ANDROID_RELEASE_KEY_ALIAS").orNull
val androidReleaseKeyPassword: String? = providers.environmentVariable("ANDROID_RELEASE_KEY_PASSWORD").orNull

if (isWearReleaseTaskRequested && androidWearVersionCode == null) {
    throw GradleException("ANDROID_WEAR_VERSION_CODE must be set to an integer for Wear OS release builds.")
}

if (isWearReleaseTaskRequested) {
    val missingSigningVariables: List<String> = listOf(
        "ANDROID_RELEASE_STORE_FILE" to androidReleaseStoreFile,
        "ANDROID_RELEASE_STORE_PASSWORD" to androidReleaseStorePassword,
        "ANDROID_RELEASE_KEY_ALIAS" to androidReleaseKeyAlias,
        "ANDROID_RELEASE_KEY_PASSWORD" to androidReleaseKeyPassword
    ).mapNotNull { (variableName, variableValue) ->
        if (variableValue.isNullOrBlank()) variableName else null
    }

    if (missingSigningVariables.isNotEmpty()) {
        throw GradleException(
            "Missing Wear OS release signing environment variables: ${missingSigningVariables.joinToString(", ")}."
        )
    }
}

android {
    namespace = "com.flashcardsopensourceapp.wear"
    compileSdk = 37

    defaultConfig {
        // The Wearable Data Layer only connects apps that share the application id and signing key.
        applicationId = "com.flashcardsopensourceapp.app"
        // Wear OS 5.
        minSdk = 34
        targetSdk = 37
        versionCode = androidWearVersionCode ?: 1
        versionName = phoneVersionName
    }

    signingConfigs {
        create("release") {
            if (!androidReleaseStoreFile.isNullOrBlank()) {
                storeFile = file(androidReleaseStoreFile)
            }

            if (!androidReleaseStorePassword.isNullOrBlank()) {
                storePassword = androidReleaseStorePassword
            }

            if (!androidReleaseKeyAlias.isNullOrBlank()) {
                keyAlias = androidReleaseKeyAlias
            }

            if (!androidReleaseKeyPassword.isNullOrBlank()) {
                keyPassword = androidReleaseKeyPassword
            }
        }
    }

    buildTypes {
        release {
            optimization {
                enable = true
            }
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        jvmToolchain(17)
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    lint {
        abortOnError = true
        warningsAsErrors = true
    }

    androidResources {
        localeFilters += phoneLocaleFilters
    }

    bundle {
        language {
            enableSplit = false
        }
    }
}

dependencies {
    implementation(project(":core:observability"))
    implementation(project(":data:local"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.room.runtime)
    implementation(libs.google.play.services.wearable)
    implementation(libs.okhttp)
    implementation(libs.org.jetbrains.kotlinx.coroutines.android)
    implementation(libs.org.jetbrains.kotlinx.coroutines.play.services)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.wear.compose.foundation)
    implementation(libs.androidx.wear.compose.material3)

    debugImplementation(libs.androidx.compose.ui.tooling)
}
