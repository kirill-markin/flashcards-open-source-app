const sampleRate = 16_000;

export class GuestPcmDecodeError extends Error {
  readonly mediaType: string;

  constructor(mediaType: string, cause: unknown) {
    super("The browser could not decode its microphone recording: " + mediaType, { cause });
    this.name = "GuestPcmDecodeError";
    this.mediaType = mediaType;
  }
}

export async function encodeGuestPcmRecording(blob: Blob, captureLimitSeconds: number): Promise<Blob> {
  let audio: AudioBuffer;
  try {
    const context = new OfflineAudioContext(1, 1, sampleRate);
    audio = await context.decodeAudioData(await blob.arrayBuffer());
  } catch (error) {
    throw new GuestPcmDecodeError(blob.type, error);
  }
  const frameCount = Math.min(audio.length, Math.floor(Math.min(120, captureLimitSeconds) * sampleRate));
  if (frameCount <= 0 || audio.numberOfChannels === 0) throw new Error("MICROPHONE_RECORDING_FAILED");
  const bytes = new ArrayBuffer(44 + frameCount * 2);
  const view = new DataView(bytes);
  function writeLabel(offset: number, label: string): void {
    for (let index = 0; index < label.length; index += 1) view.setUint8(offset + index, label.charCodeAt(index));
  }
  writeLabel(0, "RIFF");
  view.setUint32(4, 36 + frameCount * 2, true);
  writeLabel(8, "WAVE");
  writeLabel(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeLabel(36, "data");
  view.setUint32(40, frameCount * 2, true);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, channel) => audio.getChannelData(channel));
  for (let frame = 0; frame < frameCount; frame += 1) {
    const mixed = channels.reduce((sum, channel) => sum + channel[frame], 0) / channels.length;
    const sample = Math.max(-1, Math.min(1, mixed));
    view.setInt16(44 + frame * 2, Math.round(sample * (sample < 0 ? 32_768 : 32_767)), true);
  }
  return new Blob([bytes], { type: "audio/wav" });
}
