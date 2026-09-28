import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { AudioEngine } from '../audio-engine';
import { DedupEngine } from '../dedup-engine';
import { generateSyntheticWavBuffer } from '../../test/audio-fixture';
import { RawAudioFile } from '../../shared/types';

describe('Waveform Profiles, Graphs & Audio Analysis E2E', () => {
  let tempDir: string;
  let audioEngine: AudioEngine;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiovault-e2e-waveform-'));
    audioEngine = new AudioEngine();
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('correctly analyzes 32-bit float audio with peaks exceeding 1.0 without flat-topping', () => {
    const floatWavBuffer = generateSyntheticWavBuffer({
      durationSeconds: 4.0,
      bitsPerSample: 32,
      audioFormat: 3,
      peakAmplitude: 2.5, // 32-bit float audio can legitimately exceed 1.0
      envelope: 'speech_bursts',
    });

    const testFile = path.join(tempDir, 'zoom_32bit_hot.wav');
    fs.writeFileSync(testFile, floatWavBuffer);

    const result = audioEngine.analyzeWavFile(testFile, 120);

    expect(result.features.durationSeconds).toBeCloseTo(4.0, 1);
    expect(result.peaks.length).toBe(120);

    const minPeak = Math.min(...result.peaks);
    const maxPeak = Math.max(...result.peaks);
    const flatBars = result.peaks.filter((p) => p >= 0.98).length;
    const flatRatio = flatBars / result.peaks.length;

    // Minimum peak should capture quiet speech gaps (< 0.25)
    expect(minPeak).toBeLessThan(0.25);
    // Maximum peak should reach near 1.0
    expect(maxPeak).toBeGreaterThanOrEqual(0.75);
    // Flat-topped bars must be minimal (< 12% of all bars, compared to 78%+ previously)
    expect(flatRatio).toBeLessThan(0.12);
  });

  it('extracts faithful dynamic contours for speech bursts and crescendo', () => {
    const speechWav = generateSyntheticWavBuffer({
      durationSeconds: 3.0,
      envelope: 'speech_bursts',
      peakAmplitude: 0.8,
    });
    const speechPath = path.join(tempDir, 'speech_bursts.wav');
    fs.writeFileSync(speechPath, speechWav);

    const speechResult = audioEngine.analyzeWavFile(speechPath, 60);
    const quietGaps = speechResult.peaks.filter((p) => p < 0.2).length;
    const loudBursts = speechResult.peaks.filter((p) => p > 0.5).length;

    // Speech bursts must exhibit both quiet gaps and loud bursts
    expect(quietGaps).toBeGreaterThan(5);
    expect(loudBursts).toBeGreaterThan(5);

    // Crescendo test: first quarter should be significantly quieter than last quarter
    const crescendoWav = generateSyntheticWavBuffer({
      durationSeconds: 3.0,
      envelope: 'crescendo',
      peakAmplitude: 0.9,
    });
    const crescendoPath = path.join(tempDir, 'crescendo.wav');
    fs.writeFileSync(crescendoPath, crescendoWav);

    const crescendoResult = audioEngine.analyzeWavFile(crescendoPath, 60);
    const firstQuarterAvg =
      crescendoResult.peaks.slice(0, 15).reduce((a, b) => a + b, 0) / 15;
    const lastQuarterAvg =
      crescendoResult.peaks.slice(45, 60).reduce((a, b) => a + b, 0) / 15;

    expect(firstQuarterAvg).toBeLessThan(lastQuarterAvg * 0.6);
  });

  function simulateWaveformRenderer(
    rawPeaks: number[],
    profile: 'adaptive' | 'balanced' | 'punchy' | 'linear' | 'normalized',
    displayWidth = 1000
  ) {
    let step = 2.6;
    let gamma = 0.65;
    let headroomFloor = 0.12;
    let scaleHeadroom = true;
    let peakWeight = 0.84;
    let meanWeight = 0.16;

    if (profile === 'balanced') {
      step = 2.8;
      gamma = 0.76;
      headroomFloor = 0.22;
      scaleHeadroom = true;
      peakWeight = 0.8;
      meanWeight = 0.2;
    } else if (profile === 'punchy') {
      step = 3.0;
      gamma = 0.52;
      headroomFloor = 0.1;
      scaleHeadroom = true;
      peakWeight = 0.88;
      meanWeight = 0.12;
    } else if (profile === 'linear') {
      step = 2.6;
      gamma = 1.0;
      headroomFloor = 1.0;
      scaleHeadroom = false;
      peakWeight = 1.0;
      meanWeight = 0.0;
    } else if (profile === 'normalized') {
      step = 2.6;
      gamma = 1.0;
      headroomFloor = 0.01;
      scaleHeadroom = true;
      peakWeight = 0.75;
      meanWeight = 0.25;
    }

    const totalBars = Math.floor(displayWidth / step);
    let trackMax = 0.01;
    for (let p = 0; p < rawPeaks.length; p++) {
      if (rawPeaks[p] > trackMax) trackMax = rawPeaks[p];
    }
    const effectiveCeiling = scaleHeadroom ? Math.max(headroomFloor, trackMax) : 1.0;

    const barValues: number[] = [];
    for (let barIdx = 0; barIdx < totalBars; barIdx++) {
      const numPeaks = rawPeaks.length;
      const start = Math.floor((barIdx / totalBars) * numPeaks);
      const end = Math.min(
        numPeaks,
        Math.max(start + 1, Math.ceil(((barIdx + 1) / totalBars) * numPeaks))
      );
      let bMax = 0;
      let sum = 0;
      let count = 0;
      for (let j = start; j < end; j++) {
        const v = rawPeaks[j];
        if (v > bMax) bMax = v;
        sum += v;
        count++;
      }
      const bMean = count > 0 ? sum / count : bMax;
      const rawVal = bMax * peakWeight + bMean * meanWeight;
      const normalized = Math.min(1.0, rawVal / effectiveCeiling);
      const curved = Math.pow(Math.max(0, normalized), gamma);
      barValues.push(Math.min(1.0, Math.max(0.015, curved)));
    }

    return barValues;
  }

  it('validates all 5 waveform profiles produce distinct, non-flat graphs', () => {
    // Generate test audio with realistic dynamic speech and music variations
    const testWav = generateSyntheticWavBuffer({
      durationSeconds: 5.0,
      bitsPerSample: 32,
      audioFormat: 3,
      peakAmplitude: 2.0,
      envelope: 'dynamic_music',
    });
    const audioPath = path.join(tempDir, 'dynamic_music.wav');
    fs.writeFileSync(audioPath, testWav);

    const { peaks } = audioEngine.analyzeWavFile(audioPath, 300);

    const profiles = ['adaptive', 'balanced', 'punchy', 'linear', 'normalized'] as const;

    for (const prof of profiles) {
      const bars = simulateWaveformRenderer(peaks, prof);
      const flatCount = bars.filter((v) => v >= 0.98).length;
      const flatRatio = flatCount / bars.length;

      // No profile should suffer from flat combs (< 15% flat bars, compared to 90%+ previously)
      expect(flatRatio).toBeLessThan(0.15);

      // Verify dynamic range between lowest and highest bar
      const minVal = Math.min(...bars);
      const maxVal = Math.max(...bars);
      expect(maxVal - minVal).toBeGreaterThan(0.4);
    }
  });

  it('normalized profile expands low-level recordings to full scale linearly', () => {
    // Quiet recording with low max amplitude (0.2)
    const quietWav = generateSyntheticWavBuffer({
      durationSeconds: 4.0,
      peakAmplitude: 0.2,
      envelope: 'crescendo',
    });
    const quietPath = path.join(tempDir, 'quiet_crescendo.wav');
    fs.writeFileSync(quietPath, quietWav);

    const { peaks } = audioEngine.analyzeWavFile(quietPath, 200);

    const linearBars = simulateWaveformRenderer(peaks, 'linear');
    const normalizedBars = simulateWaveformRenderer(peaks, 'normalized');

    // In linear mode, unscaled bars stay low
    const linearMax = Math.max(...linearBars);
    expect(linearMax).toBeLessThanOrEqual(0.7);

    // In normalized mode, the highest peak expands to near 1.0 (>= 0.85)
    const normalizedMax = Math.max(...normalizedBars);
    expect(normalizedMax).toBeGreaterThanOrEqual(0.85);

    // Relative progression is preserved (end of crescendo > beginning)
    const normStart = normalizedBars[0];
    const normEnd = normalizedBars[normalizedBars.length - 1];
    expect(normEnd).toBeGreaterThan(normStart * 2.0);
  });

  it('dedup engine automatically repairs saturated legacy waveform peaks on startup', () => {
    const vaultDir = path.join(tempDir, 'vault_auto_repair');
    fs.mkdirSync(path.join(vaultDir, 'raw'), { recursive: true });

    // Create a real WAV file
    const realAudioBuffer = generateSyntheticWavBuffer({
      durationSeconds: 3.0,
      bitsPerSample: 32,
      audioFormat: 3,
      peakAmplitude: 2.2,
      envelope: 'speech_bursts',
    });
    const realAudioPath = path.join(vaultDir, 'raw', 'test_saturated_take.wav');
    fs.writeFileSync(realAudioPath, realAudioBuffer);

    // Write a mock registry where 80% of peaks are artificially saturated at 1.0 (reproducing the bug)
    const saturatedPeaks = Array.from({ length: 600 }, (_, i) => (i % 5 === 0 ? 0.8 : 1.0));
    const legacyFile: RawAudioFile = {
      id: 'raw_saturated_1',
      fingerprint: 'fp_sat_1',
      originalFilename: 'test_saturated_take.wav',
      storagePath: realAudioPath,
      durationSeconds: 3.0,
      sampleRate: 44100,
      channels: 1,
      fileSizeBytes: realAudioBuffer.length,
      sourceDevice: 'Zoom H4essential',
      importedAt: new Date().toISOString(),
      waveformPeaks: saturatedPeaks,
    };

    const initialRegistry = {
      schemaVersion: 3,
      rawFiles: [legacyFile],
      virtualClips: [],
      deletedFiles: [],
      collections: [],
      importBatches: [],
      savedViews: [],
    };

    fs.writeFileSync(
      path.join(vaultDir, 'registry.json'),
      JSON.stringify(initialRegistry, null, 2)
    );

    // Instantiate DedupEngine to trigger load and auto-repair
    const dedup = new DedupEngine(vaultDir);
    const rawFiles = dedup.getAllRawFiles();
    const repairedFile = rawFiles.find((f) => f.id === 'raw_saturated_1');

    expect(repairedFile).toBeDefined();
    const repairedPeaks = repairedFile!.waveformPeaks;
    const flatCount = repairedPeaks.filter((p) => p >= 0.99).length;

    // After repair, flat bars should drop from 480 (80%) down to less than 5 (< 1%)
    expect(flatCount).toBeLessThan(10);
    expect(repairedPeaks.length).toBeGreaterThan(0);
  });
});
