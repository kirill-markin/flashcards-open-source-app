export type RgbChannels = readonly [number, number, number];

const MINIMUM_CONTRAST_AGAINST_WHITE = 3;
const DARKENING_SEARCH_STEPS = 24;

function mapChannels(channels: RgbChannels, transform: (channel: number) => number): RgbChannels {
  return [transform(channels[0]), transform(channels[1]), transform(channels[2])];
}

export function parseHexColorChannels(color: string): RgbChannels {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new Error(`Accent color must be #RRGGBB, received "${color}"`);
  }
  return mapChannels([1, 3, 5], (offset) => parseInt(color.slice(offset, offset + 2), 16));
}

function formatHexColor(channels: RgbChannels): string {
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

// WCAG 2 relative luminance.
function relativeLuminance(channels: RgbChannels): number {
  const [red, green, blue] = mapChannels(channels, (channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastAgainstWhite(channels: RgbChannels): number {
  return 1.05 / (relativeLuminance(channels) + 0.05);
}

// Scaling every channel by one factor moves the color toward black and keeps its hue.
export function scaleColorChannels(channels: RgbChannels, factor: number): RgbChannels {
  return mapChannels(channels, (channel) => Math.floor(channel * factor));
}

/** The saved color darkened only as far as 3:1 contrast against white; a passing color is returned unchanged. */
export function darkenAccentForLightTheme(color: string): string {
  const channels = parseHexColorChannels(color);
  if (contrastAgainstWhite(channels) >= MINIMUM_CONTRAST_AGAINST_WHITE) {
    return color;
  }
  let passingFactor = 0;
  let failingFactor = 1;
  for (let step = 0; step < DARKENING_SEARCH_STEPS; step += 1) {
    const factor = (passingFactor + failingFactor) / 2;
    if (contrastAgainstWhite(scaleColorChannels(channels, factor)) >= MINIMUM_CONTRAST_AGAINST_WHITE) {
      passingFactor = factor;
    } else {
      failingFactor = factor;
    }
  }
  return formatHexColor(scaleColorChannels(channels, passingFactor));
}
