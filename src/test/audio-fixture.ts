/**
 * Synthetic Programmatic WAV Generator for Unit and Integration Testing.
 * Generates valid standard PCM 16-bit RIFF WAV files in memory without external assets.
 */

export interface SyntheticWavOptions {
  sampleRate?: number;
  channels?: number;
  durationSeconds?: number;
  frequency?: number;
  isPulsedSpeech?: boolean;
}

export function generateSyntheticWavBuffer(options: SyntheticWavOptions = {}): Buffer {
  const sampleRate = options.sampleRate || 44100;
  const numChannels = options.channels || 1;
  const durationSeconds = options.durationSeconds || 1.0;
  const frequency = options.frequency || 440;
  const isPulsedSpeech = !!options.isPulsedSpeech;

  const numSamples = Math.floor(sampleRate * durationSeconds);
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buffer = Buffer.alloc(totalSize);

  // RIFF Chunk Descriptor
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(totalSize - 8, 4);
  buffer.write('WAVE', 8);

  // 'fmt ' Sub-chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20);  // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34); // BitsPerSample

  // 'data' Sub-chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Sample data generation
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let amplitude = 0.5;

    if (isPulsedSpeech) {
      // Simulate speech bursts: alternating 200ms speech with 200ms silence
      const cycle = t % 0.4;
      amplitude = cycle < 0.2 ? 0.6 : 0.0;
    }

    const sampleValue = Math.sin(2 * Math.PI * frequency * t) * amplitude;
    const sampleInt16 = Math.max(-32768, Math.min(32767, Math.floor(sampleValue * 32767)));

    for (let ch = 0; ch < numChannels; ch++) {
      buffer.writeInt16LE(sampleInt16, offset);
      offset += 2;
    }
  }

  return buffer;
}
