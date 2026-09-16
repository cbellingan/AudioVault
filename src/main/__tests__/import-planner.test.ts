import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DedupEngine } from '../dedup-engine';
import { createImportPlan } from '../import-planner';
import { generateSyntheticWavBuffer } from '../../test/audio-fixture';

describe('Slice F07: Import Planning & Duplicate Explanations', () => {
  let tempDir: string;
  let vaultDir: string;
  let sourceDir: string;
  let dedupEngine: DedupEngine;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f07-test-sandbox-'));
    vaultDir = path.join(tempDir, 'vault');
    sourceDir = path.join(tempDir, 'source');
    fs.mkdirSync(vaultDir, { recursive: true });
    fs.mkdirSync(sourceDir, { recursive: true });

    dedupEngine = new DedupEngine(vaultDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('accurately categorizes new, duplicate, and excluded files without mutating vault', () => {
    const sampleWav1 = generateSyntheticWavBuffer({ durationSeconds: 0.5, frequency: 440 });
    const sampleWav2 = generateSyntheticWavBuffer({ durationSeconds: 0.5, frequency: 880 });
    const sampleWav3 = generateSyntheticWavBuffer({ durationSeconds: 0.5, frequency: 220 });

    const fileNew = path.join(sourceDir, 'NEW_RECORDING.WAV');
    const fileDup = path.join(sourceDir, 'ALREADY_IMPORTED.WAV');
    const fileExc = path.join(sourceDir, 'PREVIOUSLY_EXCLUDED.WAV');
    const fileTxt = path.join(sourceDir, 'NOTES.TXT');

    fs.writeFileSync(fileNew, sampleWav1);
    fs.writeFileSync(fileDup, sampleWav2);
    fs.writeFileSync(fileExc, sampleWav3);
    fs.writeFileSync(fileTxt, 'Not an audio file');

    // Seed duplicate into dedupEngine
    const dupFingerprint = dedupEngine.computeFileFingerprint(fileDup);
    dedupEngine.addRawFile({
      id: 'raw_seed_1',
      fingerprint: dupFingerprint,
      originalFilename: 'ALREADY_IMPORTED.WAV',
      storagePath: path.join(dedupEngine.getRawDir(), 'ALREADY_IMPORTED.WAV'),
      durationSeconds: 0.5,
      sampleRate: 44100,
      channels: 1,
      fileSizeBytes: sampleWav2.byteLength,
      sourceDevice: 'Zoom H1',
      importedAt: new Date().toISOString(),
      waveformPeaks: [0.5],
    });

    // Seed exclusion into dedupEngine
    const excFingerprint = dedupEngine.computeFileFingerprint(fileExc);
    dedupEngine.recordDeletedFile({
      id: 'del_1',
      fingerprint: excFingerprint,
      originalFilename: 'PREVIOUSLY_EXCLUDED.WAV',
      fileSizeBytes: sampleWav3.byteLength,
      deletedAt: new Date().toISOString(),
    });

    const initialRawCount = dedupEngine.getAllRawFiles().length;

    // Run import planning
    const plan = createImportPlan({
      paths: [sourceDir],
      dedupEngine,
      sourceDescription: 'Sample SD Card',
    });

    expect(plan.sourceDescription).toBe('Sample SD Card');
    expect(plan.totalFound).toBe(3); // excludes .txt file
    expect(plan.newFilesCount).toBe(1);
    expect(plan.duplicatesCount).toBe(1);
    expect(plan.excludedCount).toBe(1);

    const newItem = plan.items.find((i) => i.name === 'NEW_RECORDING.WAV');
    expect(newItem?.status).toBe('new');

    const dupItem = plan.items.find((i) => i.name === 'ALREADY_IMPORTED.WAV');
    expect(dupItem?.status).toBe('duplicate');

    const excItem = plan.items.find((i) => i.name === 'PREVIOUSLY_EXCLUDED.WAV');
    expect(excItem?.status).toBe('excluded');

    // Verify ZERO mutations occurred during planning
    expect(dedupEngine.getAllRawFiles().length).toBe(initialRawCount);
  });
});
