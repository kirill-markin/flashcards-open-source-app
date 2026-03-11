// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXTRA_AGGRESSIVE_IMAGE_COMPRESSION,
  prepareAttachment,
  recompressImageAttachment,
} from "./FileAttachment";

const { heicToMock } = vi.hoisted(() => ({
  heicToMock: vi.fn(),
}));

vi.mock("heic-to/csp", () => ({
  heicTo: heicToMock,
}));

function installSuccessfulImageEnvironment(): void {
  class SuccessfulImage {
    naturalWidth = 4_000;
    naturalHeight = 3_000;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(_value: string) {
      if (this.onload !== null) {
        this.onload();
      }
    }
  }

  vi.stubGlobal("Image", SuccessfulImage as unknown as typeof Image);
}

function installFailingImageEnvironment(): void {
  class FailingImage {
    naturalWidth = 0;
    naturalHeight = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(_value: string) {
      if (this.onerror !== null) {
        this.onerror();
      }
    }
  }

  vi.stubGlobal("Image", FailingImage as unknown as typeof Image);
}

function installCanvasMocks(): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => (
    {
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D
  ));

  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation((_type?: string, quality?: number) => {
    if (quality !== undefined && quality <= 0.55) {
      return "data:image/jpeg;base64,QQ==";
    }

    return "data:image/jpeg;base64,QUFBQUFBQUFBQQ==";
  });
}

describe("FileAttachment image processing", () => {
  beforeEach(() => {
    installCanvasMocks();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn(),
    });
    heicToMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("converts HEIC images and returns jpeg attachment payload", async () => {
    installSuccessfulImageEnvironment();
    heicToMock.mockResolvedValue(new Blob(["converted"], { type: "image/jpeg" }));

    const file = new File(["heic"], "iphone.heic", { type: "image/heic" });
    const attachment = await prepareAttachment(file);

    expect(heicToMock).toHaveBeenCalledTimes(1);
    expect(attachment.fileName).toBe("iphone.heic");
    expect(attachment.mediaType).toBe("image/jpeg");
    expect(attachment.base64Data).toBe("QUFBQUFBQUFBQQ==");
  });

  it("throws actionable error when image decoding or conversion fails", async () => {
    installFailingImageEnvironment();

    const file = new File(["broken"], "broken.png", { type: "image/png" });
    await expect(prepareAttachment(file)).rejects.toThrow(
      'Failed to process image "broken.png". Please try another image format or a smaller file.',
    );
  });

  it("produces smaller base64 payload after extra-aggressive recompression", async () => {
    installSuccessfulImageEnvironment();

    const file = new File(["png"], "sample.png", { type: "image/png" });
    const aggressiveAttachment = await prepareAttachment(file);
    const extraCompressedAttachment = await recompressImageAttachment(
      aggressiveAttachment,
      EXTRA_AGGRESSIVE_IMAGE_COMPRESSION,
    );

    expect(aggressiveAttachment.mediaType).toBe("image/jpeg");
    expect(extraCompressedAttachment.mediaType).toBe("image/jpeg");
    expect(extraCompressedAttachment.base64Data.length).toBeLessThan(aggressiveAttachment.base64Data.length);
  });
});
