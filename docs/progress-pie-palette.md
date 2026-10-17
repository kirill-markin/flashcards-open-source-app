# Progress donut chart palette

The **Review schedule** donut on the Progress tab uses one eight-colour palette on every client. Each client keeps its own copy of the hex values in its native colour form, so a palette change updates all three in the same commit: [iOS](../apps/ios/Flashcards/Flashcards/Progress/Presentation/ProgressFormatting.swift) (`progressReviewScheduleBucketColor`), [Android](../apps/android/feature/progress/src/main/java/com/flashcardsopensourceapp/feature/progress/sections/ProgressReviewScheduleSection.kt) and [Web](../apps/web/src/screens/progress/reviewSchedule/progressReviewScheduleModel.ts) (`reviewScheduleBucketColors`).

## Palette decisions

- Neighbouring buckets get clearly different hues rather than a gradient, so every adjacent wedge and legend row stays distinct; `later` is a neutral graphite.
- Brand orange is left out so wedges do not blend into titles and buttons; the accent colour appears only as selection emphasis.
- The legend swatch carries a thin neutral outline so light hues such as the `new` yellow stay defined on pale surfaces.

## Selection and accessibility contract

The behaviour is the same on every client; each draws it with its native idiom ([iOS](../apps/ios/Flashcards/Flashcards/Progress/Sections/ProgressReviewScheduleSection.swift), [Android](../apps/android/feature/progress/src/main/java/com/flashcardsopensourceapp/feature/progress/sections/ProgressReviewScheduleSection.kt), [Web](../apps/web/src/screens/progress/reviewSchedule/ProgressReviewScheduleSection.tsx) with its [styles](../apps/web/src/styles/features/progress/review-schedule.css)):

- One bucket at a time; tapping the selected bucket again, or outside the chart, clears the selection.
- While a bucket is selected, the other wedges and legend rows dim to opacity 0.35, the selected legend row gets a soft accent background, and the selected wedge is emphasized natively.
- A selection change is announced by the platform's screen reader.
- A legend row is exposed as a button only when its bucket holds cards.
