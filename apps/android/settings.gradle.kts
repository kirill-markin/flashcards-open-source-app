pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)

    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "flashcards-open-source-app-android"

include(":app")
include(":core:ui")
include(":data:local")
include(":feature:review")
include(":feature:cards")
include(":feature:ai")
include(":feature:settings")
