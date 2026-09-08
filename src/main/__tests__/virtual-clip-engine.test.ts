import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { generateSyntheticWavBuffer } from '../../test/audio-fixture';
import { DedupEngine } from '../dedup-engine';
import { RawAudioFile, VirtualClip } from '../../shared/types';

describe('Non-Destructive Virtual Clip Engine Tests', () => {
  let tempDir: string;
  let dedupEngine: DedupEngine;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiovault-clips-'));
    dedupEngine = new DedupEngine(tempDir);
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('preserves raw audio files untouched while creating virtual clips', () => {
    const wavBuffer = generateSyntheticWavBuffer({ durationSeconds: 60.0 });
    const rawPath = path.join(dedupEngine.getRawDir(), 'RAW_TAKE_01.WAV');
    fs.writeFileSync(rawPath, wavBuffer);
    const originalSize = fs.statSync(rawPath).size;

    const rawFile: RawAudioFile = {
      id: 'raw_001',
      fingerprint: dedupEngine.computeFileFingerprint(rawPath),
      originalFilename: 'RAW_TAKE_01.WAV',
      storagePath: rawPath,
      durationSeconds: 60.0,
      sampleRate: 44100,
      channels: 1,
      fileSizeBytes: originalSize,
      sourceDevice: 'Zoom H4n',
      importedAt: new Date().toISOString(),
      waveformPeaks: [0.1, 0.5, 0.9, 0.4],
    };
    dedupEngine.addRawFile(rawFile);

    // Create non-destructive virtual clip 1 (e.g. Chorus region 10s -> 25s)
    const clip1: VirtualClip = {
      id: 'clip_001',
      parentFileId: rawFile.id,
      title: 'Vocal Hook Section',
      startTimeSeconds: 10.0,
      endTimeSeconds: 25.0,
      category: 'music',
      userTags: ['Chorus', 'Harmony Take'],
      classificationConfidence: 0.9,
      classificationSource: 'yamnet_local',
      isExcluded: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    dedupEngine.addVirtualClip(clip1);

    // Create non-destructive virtual clip 2 (e.g. Excluded cough region 25s -> 28s)
    const clip2: VirtualClip = {
      id: 'clip_002',
      parentFileId: rawFile.id,
      title: 'Unwanted Noise Section',
      startTimeSeconds: 25.0,
      endTimeSeconds: 28.0,
      category: 'ambient',
      userTags: ['Noise'],
      classificationConfidence: 0.95,
      classificationSource: 'user_manual',
      isExcluded: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    dedupEngine.addVirtualClip(clip2);

    // Verify clips are recorded in index
    const allClips = dedupEngine.getVirtualClips();
    expect(allClips.length).toBe(2);

    // Verify original raw file is 100% byte-for-byte identical and intact
    expect(fs.statSync(rawPath).size).toBe(originalSize);
    expect(fs.readFileSync(rawPath).equals(wavBuffer)).toBe(true);
  });

  it('updates clip classification and custom user tags dynamically', () => {
    const updated = dedupEngine.updateVirtualClip('clip_001', {
      category: 'concerts',
      userTags: ['Chorus', 'Live Solo', 'Encore'],
    });

    expect(updated?.category).toBe('concerts');
    expect(updated?.userTags).toContain('Live Solo');

    // Persistence test: create new engine instance reading same directory
    const secondEngine = new DedupEngine(tempDir);
    const persistedClip = secondEngine.getVirtualClips().find((c) => c.id === 'clip_001');
    expect(persistedClip?.category).toBe('concerts');
    expect(persistedClip?.userTags).toContain('Encore');
  });
});
