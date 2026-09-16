import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DedupEngine } from '../dedup-engine';
import { RawAudioFile, VirtualClip } from '../../shared/types';

describe('Storage Management & Exclusions (Slice F12)', () => {
  let sandboxDirA: string;
  let sandboxDirB: string;
  let dedupEngine: DedupEngine;

  beforeEach(() => {
    process.env.AUDIOVAULT_TEST_MODE = '1';
    sandboxDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'audiovault-storage-testA-'));
    sandboxDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'audiovault-storage-testB-'));
    dedupEngine = new DedupEngine(sandboxDirA);
  });

  afterEach(() => {
    try {
      fs.rmSync(sandboxDirA, { recursive: true, force: true });
      fs.rmSync(sandboxDirB, { recursive: true, force: true });
    } catch {}
  });

  it('strictly blocks moving vault to production vault path during test mode', async () => {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    const prodVault = path.join(homeDir, 'Music', 'AudioVault');
    await expect(dedupEngine.moveVault(prodVault)).rejects.toThrow(/Strictly forbidden/);
  });

  it('computes vault statistics accurately', () => {
    const rawDir = dedupEngine.getRawDir();
    const rawPath = path.join(rawDir, 'test_take.wav');
    fs.writeFileSync(rawPath, Buffer.from('RIFF....test_audio_data_padding_bytes_here'));

    const rawRecord: RawAudioFile = {
      id: 'raw_01',
      fingerprint: 'fp_01',
      originalFilename: 'test_take.wav',
      storagePath: rawPath,
      durationSeconds: 5,
      sampleRate: 44100,
      channels: 1,
      fileSizeBytes: 42,
      sourceDevice: 'Field Recorder',
      importedAt: new Date().toISOString(),
      waveformPeaks: [],
    };
    dedupEngine.addRawFile(rawRecord);

    const rawPath2 = path.join(rawDir, 'test_take_2.wav');
    fs.writeFileSync(rawPath2, Buffer.from('RIFF....test_audio_data_2'));
    const rawRecord2: RawAudioFile = {
      id: 'raw_02',
      fingerprint: 'fp_02',
      originalFilename: 'test_take_2.wav',
      storagePath: rawPath2,
      durationSeconds: 5,
      sampleRate: 44100,
      channels: 1,
      fileSizeBytes: 30,
      sourceDevice: 'Field Recorder',
      importedAt: new Date().toISOString(),
      waveformPeaks: [],
    };
    dedupEngine.addRawFile(rawRecord2);

    const clip1: VirtualClip = {
      id: 'clip_01',
      parentFileId: 'raw_01',
      title: 'Active Take',
      startTimeSeconds: 0,
      endTimeSeconds: 5,
      category: 'music',
      userTags: ['Demo'],
      classificationConfidence: 0.9,
      classificationSource: 'yamnet_local',
      isExcluded: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    dedupEngine.addVirtualClip(clip1);

    const clip2: VirtualClip = {
      id: 'clip_02',
      parentFileId: 'raw_02',
      title: 'Hidden Take',
      startTimeSeconds: 0,
      endTimeSeconds: 5,
      category: 'dictaphone',
      userTags: ['Discarded'],
      classificationConfidence: 0.9,
      classificationSource: 'yamnet_local',
      isExcluded: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    dedupEngine.addVirtualClip(clip2);

    const stats = dedupEngine.getVaultStats();
    expect(stats.vaultDirectory).toBe(sandboxDirA);
    expect(stats.totalRecordings).toBe(1);
    expect(stats.excludedCount).toBe(1);
    expect(stats.rawFilesCount).toBe(2);
    expect(stats.totalSizeBytes).toBeGreaterThan(0);
  });

  it('restores excluded clips to active library', () => {
    const rawDir = dedupEngine.getRawDir();
    const rawPath = path.join(rawDir, 'take.wav');
    fs.writeFileSync(rawPath, Buffer.from('RIFFmock'));

    dedupEngine.addRawFile({
      id: 'raw_ex',
      fingerprint: 'fp_ex',
      originalFilename: 'take.wav',
      storagePath: rawPath,
      durationSeconds: 4,
      sampleRate: 44100,
      channels: 1,
      fileSizeBytes: 8,
      sourceDevice: 'SD Card',
      importedAt: new Date().toISOString(),
      waveformPeaks: [],
    });

    dedupEngine.addVirtualClip({
      id: 'clip_excluded',
      parentFileId: 'raw_ex',
      title: 'Take to Restore',
      startTimeSeconds: 0,
      endTimeSeconds: 4,
      category: 'dictaphone',
      userTags: ['Draft'],
      classificationConfidence: 0.8,
      classificationSource: 'yamnet_local',
      isExcluded: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const initial = dedupEngine.getVirtualClip('clip_excluded');
    expect(initial?.isExcluded).toBe(true);

    const restored = dedupEngine.restoreExcludedClip('clip_excluded');
    expect(restored?.isExcluded).toBe(false);

    const refreshed = dedupEngine.getVirtualClip('clip_excluded');
    expect(refreshed?.isExcluded).toBe(false);
  });

  it('moves entire vault cleanly, copying raw files, updating paths, and maintaining registry integrity', async () => {
    const rawDir = dedupEngine.getRawDir();
    const rawPath = path.join(rawDir, 'take_to_move.wav');
    fs.writeFileSync(rawPath, Buffer.from('RIFF....audio_bytes_to_move'));
    const txtPath = path.join(rawDir, 'take_to_move.txt');
    fs.writeFileSync(txtPath, 'Transcript to move.');

    dedupEngine.addRawFile({
      id: 'raw_move',
      fingerprint: 'fp_move',
      originalFilename: 'take_to_move.wav',
      storagePath: rawPath,
      durationSeconds: 8,
      sampleRate: 44100,
      channels: 1,
      fileSizeBytes: 100,
      sourceDevice: 'Zoom H6',
      importedAt: new Date().toISOString(),
      waveformPeaks: [],
    });

    dedupEngine.addVirtualClip({
      id: 'clip_move',
      parentFileId: 'raw_move',
      title: 'Take to Move',
      startTimeSeconds: 0,
      endTimeSeconds: 8,
      category: 'music',
      userTags: ['MoveTest'],
      classificationConfidence: 0.9,
      classificationSource: 'yamnet_local',
      transcriptPath: txtPath,
      fullTranscription: 'Transcript to move.',
      isExcluded: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const success = await dedupEngine.moveVault(sandboxDirB);
    expect(success).toBe(true);

    // Verify files copied to destination
    const newRawPath = path.join(sandboxDirB, 'raw', 'take_to_move.wav');
    const newTxtPath = path.join(sandboxDirB, 'raw', 'take_to_move.txt');
    const newRegistry = path.join(sandboxDirB, 'registry.json');
    expect(fs.existsSync(newRawPath)).toBe(true);
    expect(fs.existsSync(newTxtPath)).toBe(true);
    expect(fs.existsSync(newRegistry)).toBe(true);

    // Verify paths updated in memory and settings
    expect(dedupEngine.getVaultDir()).toBe(sandboxDirB);
    const movedClip = dedupEngine.getVirtualClip('clip_move');
    expect(movedClip?.transcriptPath).toBe(newTxtPath);

    const movedRaw = dedupEngine.getRawFile('raw_move');
    expect(movedRaw?.storagePath).toBe(newRawPath);
  });
});
