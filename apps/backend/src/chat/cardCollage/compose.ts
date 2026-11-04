import sharp from "sharp";
import {
  imageJpegCardMaximumDecodedPixels,
  imageJpegCardTransparentPixelLightCardGray,
} from "../../mediaAssets/ingestion/imageNormalization";
import { CardCollageError } from "./errors";

export type CardCollageSourceImage = Readonly<{
  mediaAssetId: string;
  bytes: Buffer;
}>;

export type CardCollageCell = Readonly<{
  left: number;
  top: number;
}>;

export type CardCollageLayout = Readonly<{
  width: number;
  height: number;
  cellWidth: number;
  cellHeight: number;
  cells: ReadonlyArray<CardCollageCell>;
}>;

const collageWidthPixels = 1_200;
const collageGapPixels = 12;
const minimumCellAspectRatio = 0.5;
const maximumCellAspectRatio = 2;
const collageJpegQuality = 90;
const supportedSourceFormats: ReadonlyArray<string> = ["jpeg", "png", "webp"];

/** The card gallery's column rule, so the collage reads like the images it replaces. */
function countCollageColumns(imageCount: number): number {
  if (imageCount === 2 || imageCount === 4) {
    return 2;
  }
  return 3;
}

function median(values: ReadonlyArray<number>): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Equal cells shaped like the median source (width / height, clamped), filled row by row, with an
 * incomplete last row centred.
 */
export function planCardCollageLayout(aspectRatios: ReadonlyArray<number>): CardCollageLayout {
  const columns = countCollageColumns(aspectRatios.length);
  const rows = Math.ceil(aspectRatios.length / columns);
  const cellWidth = Math.floor((collageWidthPixels - collageGapPixels * (columns - 1)) / columns);
  const cellAspectRatio = Math.min(
    maximumCellAspectRatio,
    Math.max(minimumCellAspectRatio, median(aspectRatios)),
  );
  const cellHeight = Math.round(cellWidth / cellAspectRatio);
  const cells = aspectRatios.map((_, index): CardCollageCell => {
    const row = Math.floor(index / columns);
    const imagesInRow = Math.min(columns, aspectRatios.length - row * columns);
    const rowOffset = Math.floor(((columns - imagesInRow) * (cellWidth + collageGapPixels)) / 2);
    return {
      left: rowOffset + (index % columns) * (cellWidth + collageGapPixels),
      top: row * (cellHeight + collageGapPixels),
    };
  });
  return {
    width: columns * cellWidth + (columns - 1) * collageGapPixels,
    height: rows * cellHeight + (rows - 1) * collageGapPixels,
    cellWidth,
    cellHeight,
    cells,
  };
}

function openSourceImage(bytes: Buffer): sharp.Sharp {
  return sharp(bytes, {
    animated: false,
    failOn: "error",
    limitInputPixels: imageJpegCardMaximumDecodedPixels,
  });
}

function createUnsupportedSourceError(mediaAssetId: string, reason: string): CardCollageError {
  return new CardCollageError(
    "image_not_supported",
    `Image ${mediaAssetId} cannot be used in a collage (${reason}); only JPEG, PNG, and WebP images can. Call again without it.`,
  );
}

async function readSourceAspectRatio(source: CardCollageSourceImage): Promise<number> {
  let metadata: sharp.Metadata;
  try {
    metadata = await openSourceImage(source.bytes).metadata();
  } catch (error) {
    throw createUnsupportedSourceError(
      source.mediaAssetId,
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!supportedSourceFormats.includes(metadata.format)) {
    throw createUnsupportedSourceError(source.mediaAssetId, `format ${metadata.format}`);
  }
  return metadata.autoOrient.width / metadata.autoOrient.height;
}

async function renderCell(
  source: CardCollageSourceImage,
  layout: CardCollageLayout,
): Promise<Buffer> {
  try {
    return await openSourceImage(source.bytes)
      .autoOrient()
      .resize({
        width: layout.cellWidth,
        height: layout.cellHeight,
        fit: "contain",
        background: imageJpegCardTransparentPixelLightCardGray,
      })
      .flatten({ background: imageJpegCardTransparentPixelLightCardGray })
      .png()
      .toBuffer();
  } catch (error) {
    throw createUnsupportedSourceError(
      source.mediaAssetId,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * One JPEG with every source fitted whole, never cropped, into its own cell, in the given order.
 * Sources are rendered one at a time so only one full-size decode is in memory at once.
 */
export async function composeCardCollage(
  sources: ReadonlyArray<CardCollageSourceImage>,
): Promise<Buffer> {
  const aspectRatios: Array<number> = [];
  for (const source of sources) {
    aspectRatios.push(await readSourceAspectRatio(source));
  }
  const layout = planCardCollageLayout(aspectRatios);
  const composites: Array<sharp.OverlayOptions> = [];
  for (const [index, source] of sources.entries()) {
    const cell = layout.cells[index];
    composites.push({ input: await renderCell(source, layout), left: cell.left, top: cell.top });
  }
  return sharp({
    create: {
      width: layout.width,
      height: layout.height,
      channels: 3,
      background: imageJpegCardTransparentPixelLightCardGray,
    },
  })
    .composite(composites)
    .jpeg({ quality: collageJpegQuality })
    .toBuffer();
}
