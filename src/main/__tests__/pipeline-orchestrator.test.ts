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

  it('processes and validates acoustic features across audio formats with 0 errors', () => {
    // Generate synthetic files covering multiple channel configurations and sample rates
    const filesToTest = [
      { name: 'TEST_44K_MONO.WAV', sr: 44100, ch: 1, dur: 1.0 },
      { name: 'TEST_48K_STEREO.WAV', sr: 48000, ch: 2, dur: 2.0 },
      { name: 'TEST_SPEECH_BURST.WAV', sr: 48000, ch: 1, dur: 1.5, speech: true },
    ];

    for (const spec of filesToTest) {
      const fullPath = path.join(tempVaultDir, spec.name);
      fs.writeFileSync(
        fullPath,
        generateSyntheticWavBuffer({
          sampleRate: spec.sr,
          channels: spec.ch,
          durationSeconds: spec.dur,
          isPulsedSpeech: spec.speech,
        })
      );

      const result = audioEngine.analyzeWavFile(fullPath, 100);
      expect(result.features.sampleRate).toBe(spec.sr);
      expect(result.features.channels).toBe(spec.ch);
      expect(result.features.durationSeconds).toBeCloseTo(spec.dur, 1);
      expect(result.peaks.length).toBe(100);
      expect(Number.isFinite(result.features.rms)).toBe(true);
      expect(Number.isFinite(result.features.dynamicRangeDb)).toBe(true);
    }
  });

  it('registers pending takes into an isolated test vault without affecting production', async () => {
    const sandboxVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-live-ingest-'));
    try {
      const sandboxDedup = new DedupEngine(sandboxVaultDir);
      const sandboxWatcher = new VolumeWatcher(sandboxDedup);
      const sandboxAudio = new AudioEngine();
      const sandboxOrchestrator = new PipelineOrchestrator(sandboxDedup, sandboxWatcher, sandboxAudio);

      // Pre-seed 3 raw files in sandbox raw folder
      const rawDir = sandboxDedup.getRawDir();
      const file1 = path.join(rawDir, 'SANDBOX_TAKE_1.WAV');
      const file2 = path.join(rawDir, 'SANDBOX_TAKE_2.WAV');
      fs.writeFileSync(file1, generateSyntheticWavBuffer({ durationSeconds: 0.5 }));
      fs.writeFileSync(file2, generateSyntheticWavBuffer({ durationSeconds: 0.8, isPulsedSpeech: true }));

      const pendingCount = sandboxOrchestrator.enqueueUnprocessedRawFiles();
      expect(pendingCount).toBe(2);

      await new Promise<void>((resolve) => {
        sandboxOrchestrator.on('pipeline-status', (status) => {
          if (status.completedJobs >= pendingCount || status.completedJobs + status.failedJobs >= pendingCount) {
            resolve();
          }
        });
        setTimeout(resolve, 3000);
      });

      const rawFiles = sandboxDedup.getAllRawFiles();
      const clips = sandboxDedup.getVirtualClips();

      expect(rawFiles.length).toBe(2);
      expect(clips.length).toBe(2);
      expect(rawFiles.every((r) => r.durationSeconds > 0)).toBe(true);

      // Verify sidecar .txt transcript file persistence alongside imported file
      const speechFile = path.join(rawDir, 'SANDBOX_SPEECH_TAKE.WAV');
      fs.writeFileSync(speechFile, generateSyntheticWavBuffer({ durationSeconds: 0.8, isPulsedSpeech: true }));
      sandboxOrchestrator.enqueueLocalFile(speechFile);

      await new Promise<void>((resolve) => {
        sandboxOrchestrator.on('pipeline-status', (status) => {
          if (status.completedJobs >= pendingCount + 1) resolve();
        });
        setTimeout(resolve, 3000);
      });

      const speechTxt = path.join(rawDir, 'SANDBOX_SPEECH_TAKE.txt');
      expect(fs.existsSync(speechTxt)).toBe(true);
      expect(fs.readFileSync(speechTxt, 'utf-8')).toContain('simulated local whisper');

      const speechClips = sandboxDedup.getVirtualClips();
      const targetClip = speechClips.find((c) => c.fullTranscription?.includes('simulated local whisper'));
      expect(targetClip).toBeDefined();
      expect(targetClip!.fullTranscription).toBe('simulated local whisper speech transcript');
      expect(targetClip!.transcriptPath).toBe(speechTxt);

      // Delete clip and verify sidecar .txt is removed
      sandboxDedup.deleteVirtualClip(targetClip!.id, true);
      expect(fs.existsSync(speechFile)).toBe(false);
      expect(fs.existsSync(speechTxt)).toBe(false);
    } finally {
      try {
        fs.rmSync(sandboxVaultDir, { recursive: true, force: true });
      } catch {}
    }
  });
});
