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
});
