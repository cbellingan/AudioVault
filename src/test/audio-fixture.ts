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
  bitsPerSample?: 16 | 32;
  audioFormat?: 1 | 3;
  peakAmplitude?: number;
  envelope?: 'flat' | 'crescendo' | 'speech_bursts' | 'dynamic_music';
}

export function generateSyntheticWavBuffer(options: SyntheticWavOptions = {}): Buffer {
  const sampleRate = options.sampleRate || 44100;
  const numChannels = options.channels || 1;
  const durationSeconds = options.durationSeconds || 1.0;
  const frequency = options.frequency || 440;
  const isPulsedSpeech = !!options.isPulsedSpeech || options.envelope === 'speech_bursts';
  const bitsPerSample = options.bitsPerSample || (options.audioFormat === 3 ? 32 : 16);
  const audioFormat = options.audioFormat || (bitsPerSample === 32 ? 3 : 1);
  const maxAmp = options.peakAmplitude !== undefined ? options.peakAmplitude : 0.6;
  const envType = options.envelope || (isPulsedSpeech ? 'speech_bursts' : 'flat');

  const numSamples = Math.floor(sampleRate * durationSeconds);
  const bytesPerSample = bitsPerSample === 32 ? 4 : 2;
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
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM / IEEE float fmt)
  buffer.writeUInt16LE(audioFormat, 20); // AudioFormat (1 = PCM, 3 = IEEE float)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // 'data' Sub-chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Sample data generation
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const progress = t / Math.max(0.001, durationSeconds);
    let amp = maxAmp;

    if (envType === 'speech_bursts') {
      // Alternating 250ms speech bursts with 150ms quiet gaps
      const cycle = t % 0.4;
      amp = cycle < 0.25 ? maxAmp * (0.6 + 0.4 * Math.sin(t * 12)) : maxAmp * 0.05;
    } else if (envType === 'crescendo') {
      // Swell from 10% to 100%
      amp = maxAmp * (0.1 + 0.9 * progress);
    } else if (envType === 'dynamic_music') {
      // Musical sections: quiet verse, loud chorus, bridge, dynamic swings
      const section = Math.sin(progress * Math.PI * 4);
      amp = maxAmp * (0.25 + 0.75 * Math.max(0, section));
    }

    const rawSignal = Math.sin(2 * Math.PI * frequency * t);
    const sampleValue = rawSignal * amp;

    if (audioFormat === 3 && bitsPerSample === 32) {
      for (let ch = 0; ch < numChannels; ch++) {
        buffer.writeFloatLE(sampleValue, offset);
        offset += 4;
      }
    } else {
      const sampleInt16 = Math.max(-32768, Math.min(32767, Math.floor(Math.min(1.0, Math.max(-1.0, sampleValue)) * 32767)));
      for (let ch = 0; ch < numChannels; ch++) {
        buffer.writeInt16LE(sampleInt16, offset);
        offset += 2;
      }
    }
  }

  return buffer;
}
