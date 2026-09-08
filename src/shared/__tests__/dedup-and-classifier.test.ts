import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { generateSyntheticWavBuffer } from '../../test/audio-fixture';
import { DedupEngine } from '../../main/dedup-engine';
import { AudioEngine } from '../../main/audio-engine';

describe('Deduplication & Classification Engine Tests', () => {
  let tempDir: string;
  let dedupEngine: DedupEngine;
  let audioEngine: AudioEngine;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiovault-test-'));
    dedupEngine = new DedupEngine(tempDir);
    audioEngine = new AudioEngine();
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('generates consistent fingerprints for identical audio files', () => {
    const wavBuffer = generateSyntheticWavBuffer({ durationSeconds: 1.0, frequency: 440 });
    const fileA = path.join(tempDir, 'take1.wav');
    const fileB = path.join(tempDir, 'take1_copy.wav');

    fs.writeFileSync(fileA, wavBuffer);
    fs.writeFileSync(fileB, wavBuffer);

    // Set same mtime for exact duplicate test
    const now = new Date();
    fs.utimesSync(fileA, now, now);
    fs.utimesSync(fileB, now, now);

    const hashA = dedupEngine.computeFileFingerprint(fileA);
    const hashB = dedupEngine.computeFileFingerprint(fileB);

    expect(hashA).toBe(hashB);
  });

  it('detects different fingerprints when content is modified', () => {
    const wavBuffer1 = generateSyntheticWavBuffer({ durationSeconds: 1.0, frequency: 440 });
    const wavBuffer2 = generateSyntheticWavBuffer({ durationSeconds: 2.0, frequency: 880 });

    const file1 = path.join(tempDir, 'file1.wav');
    const file2 = path.join(tempDir, 'file2.wav');

    fs.writeFileSync(file1, wavBuffer1);
    fs.writeFileSync(file2, wavBuffer2);

    const hash1 = dedupEngine.computeFileFingerprint(file1);
    const hash2 = dedupEngine.computeFileFingerprint(file2);

    expect(hash1).not.toBe(hash2);
  });

  it('analyzes WAV metrics and extracts normalized waveform peaks', () => {
    const wavBuffer = generateSyntheticWavBuffer({ durationSeconds: 2.0, sampleRate: 44100 });
    const filePath = path.join(tempDir, 'metric_test.wav');
    fs.writeFileSync(filePath, wavBuffer);

    const result = audioEngine.analyzeWavFile(filePath, 50);
    expect(result.features.durationSeconds).toBeCloseTo(2.0, 1);
    expect(result.features.sampleRate).toBe(44100);
    expect(result.peaks.length).toBe(50);
    expect(result.peaks[0]).toBeGreaterThan(0);
  });

  it('classifies pulsed speech audio as dictaphone or meeting', () => {
    const speechWav = generateSyntheticWavBuffer({ durationSeconds: 5.0, isPulsedSpeech: true });
    const filePath = path.join(tempDir, 'speech.wav');
    fs.writeFileSync(filePath, speechWav);

    const result = audioEngine.analyzeWavFile(filePath);
    const classification = audioEngine.classifyAcoustics(result.features, 'ZOOM_MEMO_01.WAV');

    expect(classification.category).toBe('dictaphone');
    expect(classification.confidence).toBeGreaterThan(0.7);
  });

  it('classifies continuous harmonic tone as music', () => {
    const musicWav = generateSyntheticWavBuffer({ durationSeconds: 10.0, frequency: 440 });
    const filePath = path.join(tempDir, 'singing_take.wav');
    fs.writeFileSync(filePath, musicWav);

    const result = audioEngine.analyzeWavFile(filePath);
    const classification = audioEngine.classifyAcoustics(result.features, 'VOCAL_REHEARSAL.WAV');

    expect(classification.category).toBe('music');
    expect(classification.confidence).toBeGreaterThan(0.7);
  });

  it('correctly parses BWF Broadcast Wave format with bext chunk before fmt and 32-bit float', () => {
    // Generate a BWF file: RIFF header -> bext chunk -> fmt chunk (32-bit float) -> data chunk
    const bextData = Buffer.alloc(256, 'bext metadata');
    const bextChunk = Buffer.alloc(8 + 256);
    bextChunk.write('bext', 0);
    bextChunk.writeUInt32LE(256, 4);
    bextData.copy(bextChunk, 8);

    // fmt chunk: IEEE Float (format 3), 2 channels, 48000 Hz, 32 bits
    const fmtChunk = Buffer.alloc(8 + 16);
    fmtChunk.write('fmt ', 0);
    fmtChunk.writeUInt32LE(16, 4);
    fmtChunk.writeUInt16LE(3, 8); // format 3 = IEEE float
    fmtChunk.writeUInt16LE(2, 10); // 2 channels
    fmtChunk.writeUInt32LE(48000, 12); // 48kHz
    fmtChunk.writeUInt32LE(48000 * 2 * 4, 16); // byte rate
    fmtChunk.writeUInt16LE(8, 20); // block align
    fmtChunk.writeUInt16LE(32, 22); // 32 bits per sample

    // data chunk: 48000 samples * 2 channels * 4 bytes = 384000 bytes (1 second)
    const numSamples = 48000;
    const dataSize = numSamples * 2 * 4;
    const dataChunk = Buffer.alloc(8 + dataSize);
    dataChunk.write('data', 0);
    dataChunk.writeUInt32LE(dataSize, 4);
    for (let i = 0; i < numSamples; i++) {
      const floatVal = Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.5;
      dataChunk.writeFloatLE(floatVal, 8 + i * 8); // left
      dataChunk.writeFloatLE(floatVal, 8 + i * 8 + 4); // right
    }

    const totalRiffSize = 4 + bextChunk.length + fmtChunk.length + dataChunk.length;
    const riffHeader = Buffer.alloc(12);
    riffHeader.write('RIFF', 0);
    riffHeader.writeUInt32LE(totalRiffSize, 4);
    riffHeader.write('WAVE', 8);

    const bwfFile = Buffer.concat([riffHeader, bextChunk, fmtChunk, dataChunk]);
    const filePath = path.join(tempDir, 'bwf_32float.wav');
    fs.writeFileSync(filePath, bwfFile);

    const result = audioEngine.analyzeWavFile(filePath, 50);
    expect(result.features.durationSeconds).toBeCloseTo(1.0, 1);
    expect(result.features.sampleRate).toBe(48000);
    expect(result.features.channels).toBe(2);
    expect(result.peaks.length).toBe(50);
    expect(result.peaks[10]).toBeGreaterThan(0.2);
  });
});
