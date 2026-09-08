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
          let transformersModule: any;
          try {
            transformersModule = await import('@xenova/transformers');
          } catch {
            transformersModule = await (new Function('return import("@xenova/transformers")')());
          }
          const { pipeline } = transformersModule as typeof import('@xenova/transformers');

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
   * Reads a WAV file from disk, decodes PCM/IEEE float, resamples to 16kHz mono, and runs local Whisper inference.
   * Supports starting from any startOffsetSeconds within the file.
   */
  public async transcribeAudioFile(
    filePath: string,
    maxDurationSeconds = 60,
    startOffsetSeconds = 0
  ): Promise<TranscriptionResult | null> {
    try {
      const transcriber = await this.getTranscriber();
      if (!transcriber) return null;

      const audioData = this.decodeWavToFloat32_16k(filePath, maxDurationSeconds, startOffsetSeconds);
      if (!audioData || audioData.length === 0) return null;

      // Run local Whisper inference on Float32Array with timestamps enabled
      const output = await transcriber(audioData, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: true,
      });

      if (output && typeof output.text === 'string') {
        const cleanedText = output.text.trim();
        const chunks = Array.isArray(output.chunks)
          ? output.chunks.map((c: any) => ({
              text: (c.text || '').trim(),
              timestamp: Array.isArray(c.timestamp)
                ? [
                    parseFloat(((c.timestamp[0] ?? 0) + startOffsetSeconds).toFixed(2)),
                    parseFloat(((c.timestamp[1] ?? 0) + startOffsetSeconds).toFixed(2)),
                  ] as [number, number]
                : [startOffsetSeconds, startOffsetSeconds] as [number, number],
            }))
          : undefined;

        return {
          text: cleanedText,
          language: 'en',
          chunks,
        };
      }
      return null;
    } catch (err) {
      console.warn(`Whisper transcription skipped for ${filePath}:`, err);
      return null;
    }
  }

  /**
   * Decodes a PCM / IEEE float WAV file into a 16kHz mono Float32Array,
   * starting from startOffsetSeconds.
   */
  public decodeWavToFloat32_16k(
    filePath: string,
    maxDurationSeconds: number,
    startOffsetSeconds = 0
  ): Float32Array | null {
    if (!fs.existsSync(filePath)) return null;
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;
    const fd = fs.openSync(filePath, 'r');

    try {
      // Read header to parse RIFF chunks
      const headerSize = Math.min(65536, fileSize);
      const header = Buffer.alloc(headerSize);
      fs.readSync(fd, header, 0, headerSize, 0);

      if (headerSize < 12 || header.toString('ascii', 0, 4) !== 'RIFF') {
        return null;
      }

      let sampleRate = 44100;
      let numChannels = 1;
      let bitsPerSample = 16;
      let audioFormat = 1;
      let dataOffset = 44;
      let dataLength = fileSize - 44;

      let pos = 12;
      while (pos < headerSize - 8) {
        const chunkId = header.toString('ascii', pos, pos + 4);
        const chunkSize = header.readUInt32LE(pos + 4);

        if (chunkId === 'fmt ') {
          if (pos + 8 + 16 <= headerSize) {
            audioFormat = header.readUInt16LE(pos + 8);
            numChannels = Math.max(1, header.readUInt16LE(pos + 10));
            sampleRate = Math.max(8000, header.readUInt32LE(pos + 12));
            bitsPerSample = Math.max(8, header.readUInt16LE(pos + 22));
          }
        } else if (chunkId === 'data') {
          dataOffset = pos + 8;
          dataLength = Math.min(chunkSize, fileSize - dataOffset);
          break;
        }

        pos += 8 + chunkSize;
        if (chunkSize % 2 !== 0) pos++;
      }

      const bytesPerSample = Math.max(1, Math.floor(bitsPerSample / 8));
      const blockAlign = bytesPerSample * numChannels;
      const totalInputSamples = blockAlign > 0 ? Math.floor(dataLength / blockAlign) : 0;

      const startSample = Math.min(totalInputSamples, Math.floor(sampleRate * Math.max(0, startOffsetSeconds)));
      const samplesRemaining = Math.max(0, totalInputSamples - startSample);
      const samplesToRead = Math.min(samplesRemaining, Math.floor(sampleRate * maxDurationSeconds));

      if (samplesToRead <= 0) return null;

      const bytesToRead = samplesToRead * blockAlign;
      const readByteOffset = dataOffset + startSample * blockAlign;
      const rawAudioBuffer = Buffer.alloc(bytesToRead);
      fs.readSync(fd, rawAudioBuffer, 0, bytesToRead, readByteOffset);

      // Linear resampling ratio to 16000 Hz
      const targetSampleRate = 16000;
      const resampleRatio = targetSampleRate / sampleRate;
      const targetLength = Math.floor(samplesToRead * resampleRatio);
      const output = new Float32Array(targetLength);

      for (let i = 0; i < targetLength; i++) {
        const originalSampleIndex = Math.floor(i / resampleRatio);
        const bytePos = originalSampleIndex * blockAlign;
        if (bytePos + bytesPerSample > rawAudioBuffer.length) break;

        let val = 0;
        if (audioFormat === 3 && bitsPerSample === 32) {
          val = rawAudioBuffer.readFloatLE(bytePos);
        } else if (bitsPerSample === 16) {
          val = rawAudioBuffer.readInt16LE(bytePos) / 32768.0;
        } else if (bitsPerSample === 24) {
          val = rawAudioBuffer.readIntLE(bytePos, 3) / 8388608.0;
        } else if (bitsPerSample === 32) {
          val = rawAudioBuffer.readInt32LE(bytePos) / 2147483648.0;
        } else {
          val = (rawAudioBuffer.readUInt8(bytePos) - 128) / 128.0;
        }

        if (isNaN(val) || !isFinite(val)) val = 0;
        output[i] = Math.max(-1.0, Math.min(1.0, val));
      }

      return output;
    } finally {
      fs.closeSync(fd);
    }
  }
}
