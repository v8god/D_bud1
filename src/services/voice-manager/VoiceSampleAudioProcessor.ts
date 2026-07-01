const TARGET_SAMPLE_RATE = 24_000;
const MIN_DURATION_SECONDS = 8;
const MAX_DURATION_SECONDS = 35;

export interface ProcessedVoiceSample {
  readonly wavBytes: Uint8Array;
  readonly durationSeconds: number;
}

export async function processVoiceSample(input: Blob): Promise<ProcessedVoiceSample> {
  const sourceBytes = await input.arrayBuffer();
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(sourceBytes.slice(0));
    if (decoded.duration < MIN_DURATION_SECONDS || decoded.duration > MAX_DURATION_SECONDS) {
      throw new Error(
        `Use a clear voice sample between ${MIN_DURATION_SECONDS} and ${MAX_DURATION_SECONDS} seconds. This sample is ${decoded.duration.toFixed(1)} seconds.`,
      );
    }

    const frameCount = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE);
    const offline = new OfflineAudioContext(1, frameCount, TARGET_SAMPLE_RATE);
    const buffer = offline.createBuffer(1, decoded.length, decoded.sampleRate);
    const mono = buffer.getChannelData(0);

    for (let frame = 0; frame < decoded.length; frame += 1) {
      let total = 0;
      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
        total += decoded.getChannelData(channel)[frame] ?? 0;
      }
      mono[frame] = total / decoded.numberOfChannels;
    }

    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0).slice();
    normalize(samples);

    return {
      wavBytes: encodePcm16Wav(samples, TARGET_SAMPLE_RATE),
      durationSeconds: rendered.duration,
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function normalize(samples: Float32Array): void {
  let peak = 0;
  let squareSum = 0;
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample));
    squareSum += sample * sample;
  }
  const rms = Math.sqrt(squareSum / Math.max(1, samples.length));
  if (rms < 0.008) {
    throw new Error("The voice sample is too quiet. Record closer to the microphone in a quiet room.");
  }

  const gain = peak > 0 ? Math.min(5, 0.94 / peak) : 1;
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.max(-1, Math.min(1, (samples[index] ?? 0) * gain));
  }
}

function encodePcm16Wav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 2;
  const headerSize = 44;
  const output = new ArrayBuffer(headerSize + samples.length * bytesPerSample);
  const view = new DataView(output);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = headerSize;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }

  return new Uint8Array(output);
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}
