# Progress donut chart palette

Canonical color palette for the **Review schedule** donut chart on the Progress tab. The same hex values are duplicated in each client because each platform consumes color in a different native form (`SwiftUI.Color`, Compose `Color`, CSS hex).

**Whenever a hex value here changes, update all three client files in the same commit.** No exceptions — visual parity across iOS / Android / Web is the point of this palette.

## Palette

Ordered by `ReviewScheduleBucketKey.stableOrder`:

| # | Bucket key      | Hex       | Note                                  |
|---|-----------------|-----------|---------------------------------------|
| 1 | `new`           | `#F4C430` | Sunglow yellow — fresh, untouched     |
| 2 | `today`         | `#D7263D` | Crimson — urgent, distinct from brand |
| 3 | `days1To7`      | `#1FB5C1` | Cyan-teal                             |
| 4 | `days8To30`     | `#8E5BD9` | Violet                                |
| 5 | `days31To90`    | `#2BB673` | Emerald                               |
| 6 | `days91To360`   | `#E69F00` | Honey amber                           |
| 7 | `years1To2`     | `#3F7CC8` | Steel blue                            |
| 8 | `later`         | `#7A8088` | Slate graphite — neutral / archived   |

Properties: 8 distinct hues arranged so that **adjacent** buckets alternate warm/cool families and sit ≥ 56° apart on the hue wheel — the goal is sharp contrast between every neighbouring legend row and donut wedge, not a smooth gradient. The legend swatch wraps each fill in a thin neutral outline so that high-luminance hues like sunglow stay defined against pale surfaces (`box-shadow` on Web, `Color.primary.opacity(0.08)` on iOS, `outlineVariant` on Android). Brand orange (`#C44B2D`) is intentionally **not** in the palette so wedges don't blend into surrounding accents (titles, buttons). The accent color returns only as the *selection emphasis ring*.

## Selection emphasis

The functional contract is identical across clients — single-select, second tap on the same bucket clears it, click outside the chart clears it, and non-selected segments and legend rows dim to opacity 0.35. The wedge emphasis itself is per-platform native, because each client's CLAUDE.md rule is to stay maximally native to its platform (iOS-native on iOS, Material 3 on Android) rather than force a single visual treatment everywhere.

Shared invariants when one bucket is selected:
- Non-selected segments and legend rows render at **opacity 0.35**.
- The selected legend row gets a soft accent background: `Color.accentColor.opacity(0.12)` on iOS, `MaterialTheme.colorScheme.primaryContainer` at 20% alpha on Android, `var(--accent-soft)` on Web.

Per-platform selected-wedge emphasis:

| Client  | Selected wedge treatment                                                                                       |
|---------|----------------------------------------------------------------------------------------------------------------|
| iOS     | `outerRadius` pop-out — selected wedge `.ratio(1.0)`, others `.ratio(0.94)`. Swift Charts' `SectorMark` exposes no stroke modifier, so the pop-out is the native idiom. |
| Android | 2 dp accent stroke drawn just outside the selected wedge in `MaterialTheme.colorScheme.primary`.               |
| Web     | 2 px accent stroke on the selected `<path>` (`var(--accent)`) plus `transform: scale(1.03)` for a subtle pop.  |

## Accessibility

Every client must announce the selected bucket to its native assistive tech (VoiceOver / TalkBack / web screen readers) when selection changes, and every client must mark interactive legend rows as buttons only when they are actually tappable (zero-count rows are not announced as buttons). The per-platform mechanisms differ because each client uses its native a11y API, but the user-observable contract is identical.

| Client  | Selected-bucket announce                                                                                       | Legend-row role                                                                                  |
|---------|----------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------|
| iOS     | Dynamic `chartAccessibilityValue` prepended to the chart's `.accessibilityValue`; SwiftUI re-emits the value-changed notification so VoiceOver re-announces while focused. | `.accessibilityAddTraits(.isButton)` only when `bucket.count > 0`.                               |
| Android | Dynamic `contentDescription` plus `liveRegion = LiveRegionMode.Polite` on the chart, so TalkBack proactively announces the change even if focus is on a legend row. | `role = Role.Button` and `selected = isSelected` set only when `isInteractive` (`count > 0`).    |
| Web     | Announced via `aria-pressed` toggling on the focused legend `<button>`, since the legend is the keyboard-focused element when toggling. | Native `<button>` element with `disabled` attribute when `count === 0`, which removes it from the Tab order. |

Whenever any client's a11y mechanism changes (e.g., a new screen reader API replaces an old one), update the table here in the same change so this doc stays the source of truth.

## Source-of-truth files

| Client  | File                                                                                                              | Symbol                                  |
|---------|-------------------------------------------------------------------------------------------------------------------|-----------------------------------------|
| iOS     | `apps/ios/Flashcards/Flashcards/Progress/ProgressScreen.swift`                                                    | `progressReviewScheduleBucketColor(key:)` |
| Android | `apps/android/feature/progress/src/main/java/com/flashcardsopensourceapp/feature/progress/ProgressRoute.kt`       | `reviewScheduleBucketColors`            |
| Web     | `apps/web/src/screens/progress/ProgressScreen.tsx`                                                                | `reviewScheduleBucketColors`            |
