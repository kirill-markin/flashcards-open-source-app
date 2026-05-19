plugins {
    alias(libs.plugins.android.library)
}

android {
    namespace = "com.flashcardsopensourceapp.core.observability"
    compileSdk = 36

    defaultConfig {
        minSdk = 34
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        jvmToolchain(17)
    }
}
