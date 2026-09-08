import fs from 'fs';

export interface TranscriptionResult {
  text: string;
  language?: string;
  chunks?: Array<{ text: string; timestamp: [number, number] }>;
}

export class TranscriptionService {
  private transcriberPromise: Promise<any> | null = null;
  private isInitialized = false;

  /**
   * Lazily loads the quantized Whisper-tiny model on-device.
   */
  private async getTranscriber() {
    if (!this.transcriberPromise) {
      this.transcriberPromise = (async () => {
        try {
          // Dynamic ESM import to support Electron CJS runtime without ERR_REQUIRE_ESM
          const { pipeline } = (await (new Function(
            'return import("@xenova/transformers")'
          )())) as typeof import('@xenova/transformers');

          const p = await pipeline(
            'automatic-speech-recognition',
            'Xenova/whisper-tiny.en',
            {
              quantized: true,
            }
          );
          this.isInitialized = true;
          return p;
        } catch (err) {
          console.error('Failed to load local Whisper model:', err);
          return null;
        }
      })();
    }
    return this.transcriberPromise;
  }

  /**
   * Reads a WAV file from disk, decodes 16-bit PCM, resamples to 16kHz mono, and runs local Whisper inference.
   */
  public async transcribeAudioFile(
    filePath: string,
    maxDurationSeconds = 60
  ): Promise<TranscriptionResult | null> {
    try {
      const transcriber = await this.getTranscriber();
      if (!transcriber) return null;

      const audioData = this.decodeWavToFloat32_16k(filePath, maxDurationSeconds);
      if (!audioData || audioData.length === 0) return null;

      // Run local Whisper inference on Float32Array
      const output = await transcriber(audioData, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false,
      });

      if (output && typeof output.text === 'string') {
        const cleanedText = output.text.trim();
        return {
          text: cleanedText,
          language: 'en',
        };
      }
      return null;
    } catch (err) {
      console.warn(`Whisper transcription skipped for ${filePath}:`, err);
      return null;
    }
  }

  /**
   * Decodes a standard PCM 16-bit WAV file into a 16kHz mono Float32Array.
   */
  public decodeWavToFloat32_16k(filePath: string, maxDurationSeconds: number): Float32Array | null {
    if (!fs.existsSync(filePath)) return null;
    const buffer = fs.readFileSync(filePath);

    if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') {
      return null;
    }

    const sampleRate = buffer.readUInt32LE(24);
    const numChannels = buffer.readUInt16LE(22);
    const bitsPerSample = buffer.readUInt16LE(34);

    if (bitsPerSample !== 16) {
      // Basic 16-bit PCM expected
      return null;
    }

    // Find 'data' chunk
    let pos = 12;
    let dataOffset = 44;
    let dataLength = buffer.length - 44;

    while (pos < buffer.length - 8) {
      const chunkId = buffer.toString('ascii', pos, pos + 4);
      const chunkSize = buffer.readUInt32LE(pos + 4);
      if (chunkId === 'data') {
        dataOffset = pos + 8;
        dataLength = Math.min(chunkSize, buffer.length - dataOffset);
        break;
      }
      pos += 8 + chunkSize;
    }

    const bytesPerSample = 2;
    const totalInputSamples = Math.floor(dataLength / (bytesPerSample * numChannels));
    const maxSamplesToRead = Math.min(totalInputSamples, Math.floor(sampleRate * maxDurationSeconds));

    if (maxSamplesToRead <= 0) return null;

    // Linear resampling ratio to 16000 Hz
    const targetSampleRate = 16000;
    const resampleRatio = targetSampleRate / sampleRate;
    const targetLength = Math.floor(maxSamplesToRead * resampleRatio);
    const output = new Float32Array(targetLength);

    for (let i = 0; i < targetLength; i++) {
      const originalSampleIndex = Math.floor(i / resampleRatio);
      const bytePos = dataOffset + originalSampleIndex * bytesPerSample * numChannels;
      if (bytePos + 2 > buffer.length) break;

      // Read channel 0 (mono / left channel)
      const int16Val = buffer.readInt16LE(bytePos);
      output[i] = int16Val / 32768.0;
    }

    return output;
  }
}
