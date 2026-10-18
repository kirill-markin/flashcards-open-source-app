import { Buffer } from "node:buffer";
import { HttpError } from "../shared/errors";

export async function readGuestPcmAudio(file: File): Promise<Readonly<{ bytes: Buffer; seconds: number }>> {
  if (file.size <= 44 || file.size > 3_840_044) {
    throw new HttpError(400, "Guest recordings must contain at most 120 seconds of mono 16 kHz 16-bit PCM WAV audio.",
      "BROWSER_GUEST_AI_TRIAL_AUDIO_INVALID");
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length !== file.size
    || bytes.toString("utf8", 0, 4) !== "RIFF"
    || bytes.readUInt32LE(4) !== bytes.length - 8
    || bytes.toString("utf8", 8, 12) !== "WAVE"
    || bytes.toString("utf8", 12, 16) !== "fmt "
    || bytes.readUInt32LE(16) !== 16
    || bytes.readUInt16LE(20) !== 1
    || bytes.readUInt16LE(22) !== 1
    || bytes.readUInt32LE(24) !== 16000
    || bytes.readUInt32LE(28) !== 32000
    || bytes.readUInt16LE(32) !== 2
    || bytes.readUInt16LE(34) !== 16
    || bytes.toString("utf8", 36, 40) !== "data"
    || bytes.readUInt32LE(40) !== bytes.length - 44
    || (bytes.length - 44) % 2 !== 0) {
    throw new HttpError(400, "Guest recordings require canonical PCM WAV with an exact 44-byte header and no extra chunks.",
      "BROWSER_GUEST_AI_TRIAL_AUDIO_INVALID");
  }
  return { bytes, seconds: Math.ceil((bytes.length - 44) / 32000) };
}
