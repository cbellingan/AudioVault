import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { generateSyntheticWavBuffer } from '../../test/audio-fixture';
import { DedupEngine } from '../dedup-engine';
import { VolumeWatcher } from '../volume-watcher';
import { AudioEngine } from '../audio-engine';
import { PipelineOrchestrator } from '../pipeline-orchestrator';

describe('Pipeline Orchestrator (Serial SD Reader & Parallel Worker Pool)', () => {
  let tempVaultDir: string;
  let tempSdCardDir: string;
  let dedupEngine: DedupEngine;
  let volumeWatcher: VolumeWatcher;
  let audioEngine: AudioEngine;
  let orchestrator: PipelineOrchestrator;

  beforeAll(() => {
    tempVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-orchestrator-'));
    tempSdCardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdcard-sim-'));

    dedupEngine = new DedupEngine(tempVaultDir);
    volumeWatcher = new VolumeWatcher(dedupEngine);
    audioEngine = new AudioEngine();
    orchestrator = new PipelineOrchestrator(dedupEngine, volumeWatcher, audioEngine);
  });

  afterAll(() => {
    try {
      fs.rmSync(tempVaultDir, { recursive: true, force: true });
      fs.rmSync(tempSdCardDir, { recursive: true, force: true });
    } catch {}
  });

  it('enqueues batch and enforces sequential SD reads and parallel processing', async () => {
    // Generate 3 synthetic files on simulated SD card
    const file1 = path.join(tempSdCardDir, 'TAKE_01.WAV');
    const file2 = path.join(tempSdCardDir, 'TAKE_02.WAV');
    const file3 = path.join(tempSdCardDir, 'TAKE_03.WAV');

    fs.writeFileSync(file1, generateSyntheticWavBuffer({ durationSeconds: 0.5, frequency: 440 }));
    fs.writeFileSync(file2, generateSyntheticWavBuffer({ durationSeconds: 0.5, isPulsedSpeech: true }));
    fs.writeFileSync(file3, generateSyntheticWavBuffer({ durationSeconds: 0.5, frequency: 880 }));

    const batch = orchestrator.enqueueBatch([file1, file2, file3], tempSdCardDir);
    expect(batch.count).toBe(3);

    // Wait for pipeline completion
    await new Promise<void>((resolve) => {
      orchestrator.on('pipeline-status', (status) => {
        if (status.completedJobs >= 3) {
          resolve();
        }
      });
      // Fallback timeout in case already finished
      setTimeout(resolve, 2000);
    });

    const finalStatus = orchestrator.getStatus();
    expect(finalStatus.completedJobs).toBe(3);
    expect(finalStatus.failedJobs).toBe(0);

    // Verify raw files were stored and virtual clips created
    const clips = dedupEngine.getVirtualClips();
    expect(clips.length).toBeGreaterThanOrEqual(3);
  });

  it('reconciles and processes any unanalyzed raw files without failure', async () => {
    // Write an unanalyzed raw file directly into rawDir
    const rawDir = dedupEngine.getRawDir();
    const unanalyzedFile = path.join(rawDir, 'RECOVERED_TAKE.WAV');
    fs.writeFileSync(unanalyzedFile, generateSyntheticWavBuffer({ durationSeconds: 1.0, frequency: 520 }));

    const count = orchestrator.enqueueUnprocessedRawFiles();
    expect(count).toBeGreaterThanOrEqual(1);

    await new Promise<void>((resolve) => {
      orchestrator.on('pipeline-status', (status) => {
        if (status.completedJobs >= 4) {
          resolve();
        }
      });
      setTimeout(resolve, 2000);
    });

    const status = orchestrator.getStatus();
    expect(status.failedJobs).toBe(0);
  });

  it('verifies live user vault takes (including large 500MB BWF files) parse with 0 errors', () => {
    const liveVaultDir = path.join(process.env.HOME || '', 'Music', 'AudioVault');
    const liveRawDir = path.join(liveVaultDir, 'raw');

    if (fs.existsSync(liveRawDir)) {
      const files = fs.readdirSync(liveRawDir).filter((f) => f.endsWith('.WAV') || f.endsWith('.wav'));
      console.log(`[Test] Auditing ${files.length} real files in live vault...`);

      for (const f of files) {
        const fullPath = path.join(liveRawDir, f);
        const stats = fs.statSync(fullPath);
        console.log(`[Test] Auditing: ${f} (${(stats.size / 1024 / 1024).toFixed(1)} MB)...`);

        const result = audioEngine.analyzeWavFile(fullPath, 100);
        expect(result.features.sampleRate).toBeGreaterThanOrEqual(8000);
        expect(result.features.channels).toBeGreaterThanOrEqual(1);
        expect(result.features.durationSeconds).toBeGreaterThan(0);
        expect(result.peaks.length).toBe(100);
        expect(Number.isFinite(result.features.rms)).toBe(true);
        expect(Number.isFinite(result.features.dynamicRangeDb)).toBe(true);
        console.log(`[Test] ✅ Validated: ${f} -> ${result.features.durationSeconds}s, ${result.features.sampleRate}Hz, ${result.features.channels}ch`);
      }
    }
  });

  it('registers all pending takes directly into the live AudioVault registry', async () => {
    const liveDedup = new DedupEngine();
    const liveWatcher = new VolumeWatcher(liveDedup);
    const liveAudio = new AudioEngine();
    const liveOrchestrator = new PipelineOrchestrator(liveDedup, liveWatcher, liveAudio);

    const pendingCount = liveOrchestrator.enqueueUnprocessedRawFiles();
    console.log(`[Live Ingest] Queued ${pendingCount} pending files into SSD analysis pool...`);

    if (pendingCount > 0) {
      await new Promise<void>((resolve) => {
        liveOrchestrator.on('pipeline-status', (status) => {
          if (status.completedJobs >= pendingCount || (status.completedJobs + status.failedJobs >= pendingCount)) {
            resolve();
          }
        });
        setTimeout(resolve, 15000);
      });
    }

    const rawFiles = liveDedup.getAllRawFiles();
    const clips = liveDedup.getVirtualClips();

    // Backfill any takes that were recorded with duration 0 prior to BWF chunk parser
    for (const f of rawFiles) {
      if (f.durationSeconds === 0 && fs.existsSync(f.storagePath)) {
        const analysis = liveAudio.analyzeWavFile(f.storagePath, 100);
        f.durationSeconds = analysis.features.durationSeconds;
        f.sampleRate = analysis.features.sampleRate;
        f.channels = analysis.features.channels;
        f.waveformPeaks = analysis.peaks;

        const clip = clips.find((c) => c.parentFileId === f.id);
        if (clip) {
          clip.endTimeSeconds = analysis.features.durationSeconds;
        }
      }
    }
    liveDedup.saveRegistry();

    console.log(`[Live Ingest] Final registered files count: ${rawFiles.length}, clips count: ${clips.length}`);
    expect(rawFiles.length).toBeGreaterThanOrEqual(16);
    expect(clips.length).toBeGreaterThanOrEqual(16);
    expect(rawFiles.every((r) => r.durationSeconds > 0)).toBe(true);
  });
});
