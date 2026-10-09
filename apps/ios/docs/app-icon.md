# Apple app icon

Nibomo uses `../Flashcards/Flashcards/AppIcon.icon`, an editable Icon Composer
document with two SVG card layers. Xcode 27 or newer is required to read its
refraction and specular-placement annotations.

The icon preserves the existing card positions, sizes, corner radii, and orange
`#c44b2d`. Each card has its own subtle native Liquid Glass material; lighting,
shadows, translucency, refraction, and the rounded icon mask are rendered by
Apple rather than baked into the artwork.

The canvas uses Apple's `automatic` fill. Default appearance uses the system
light background and a charcoal rear card (`#232323`); Dark uses the system dark
background and a warm white rear card (`#f8f3ec`). Home Screen icon appearance
can be selected independently of the app's appearance. Mono uses a white front
card and 55% gray rear card so the overlap remains legible in clear and tinted
appearances.

| Default | Dark |
| --- | --- |
| ![Default icon](media/app-icon/default.png) | ![Dark icon](media/app-icon/dark.png) |

`ASSETCATALOG_COMPILER_APPICON_NAME` remains `AppIcon`. The app's synchronized
source group includes the `.icon` package automatically. Xcode gives the
matching Composer document precedence over the retained `AppIcon.appiconset`
and generates fallback icons for earlier systems. The deployment target remains
iOS/iPadOS 18.0.

## Verification

Build the app with the current Xcode, then install it on an iPhone and iPad.
Inspect Home Screen Default, Dark, Clear Light/Dark and Tinted Light/Dark at
normal and large icon sizes. Check that both card shapes remain distinct and
the rear card inverts correctly. Confirm the build generates older-system
fallback images; use an actual supported older OS for device verification.

To export an appearance directly from the native renderer:

```sh
"/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool" \
  apps/ios/Flashcards/Flashcards/AppIcon.icon \
  --export-image --output-file /tmp/nibomo-icon.png \
  --platform iOS --rendition Default --width 1024 --height 1024 --scale 1 \
  --design-generation 27
```

Use `Dark`, `ClearLight`, `ClearDark`, `TintedLight`, or `TintedDark` for the other
appearances. Use `--design-generation 26` to review the previous rendering;
Apple documents that refraction has no visible effect before OS 27.

References: [Apple's Icon Composer workflow](https://developer.apple.com/documentation/xcode/creating-your-app-icon-using-icon-composer),
[App icon HIG](https://developer.apple.com/design/human-interface-guidelines/app-icons),
[WWDC26 Icon Composer lab](https://developer.apple.com/videos/play/wwdc2026/8012/).
