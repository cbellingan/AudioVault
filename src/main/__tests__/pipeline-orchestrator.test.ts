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

  it('keeps registry.json clean of transcript bloat and migrates legacy entries to sidecar files', async () => {
    const sandboxVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-clean-registry-'));
    try {
      const rawDir = path.join(sandboxVaultDir, 'raw');
      fs.mkdirSync(rawDir, { recursive: true });

      // Create a raw WAV take
      const takePath = path.join(rawDir, 'LEGACY_SPEECH_TAKE.WAV');
      fs.writeFileSync(takePath, generateSyntheticWavBuffer({ durationSeconds: 0.5, isPulsedSpeech: true }));

      // Simulate a legacy registry.json with embedded transcript text and no sidecar .txt
      const legacyRegistry = {
        version: 1,
        rawFiles: [
          {
            id: 'legacy-raw-1',
            fingerprint: 'legacyfingerprint123',
            originalFilename: 'LEGACY_SPEECH_TAKE.WAV',
            storagePath: takePath,
            fileSizeBytes: 1000,
            durationSeconds: 0.5,
            sampleRate: 44100,
            channels: 1,
            sourceDevice: 'SD-Card',
            importedAt: new Date().toISOString(),
            waveformPeaks: [0.1, 0.5, 0.2],
          },
        ],
        virtualClips: [
          {
            id: 'legacy-clip-1',
            parentFileId: 'legacy-raw-1',
            title: 'Legacy Clip with Embedded Transcript',
            startTimeSeconds: 0,
            endTimeSeconds: 0.5,
            category: 'dictaphone',
            userTags: ['Meeting Note'],
            classificationConfidence: 0.95,
            transcription: 'Legacy in-registry transcript snippet',
            fullTranscription: 'Legacy in-registry transcript snippet that should be migrated to disk',
            createdAt: new Date().toISOString(),
          },
        ],
        deletedHashes: [],
        settings: {
          vaultPath: sandboxVaultDir,
          watchDirectory: '',
          autoUnmountAfterIngest: false,
          rememberDeleteChoice: false,
        },
      };

      const registryPath = path.join(sandboxVaultDir, 'registry.json');
      fs.writeFileSync(registryPath, JSON.stringify(legacyRegistry, null, 2), 'utf-8');

      // Initialize DedupEngine: loadRegistry should automatically extract the legacy transcript to sidecar .txt
      const sandboxDedup = new DedupEngine(sandboxVaultDir);
      const sidecarTxt = path.join(rawDir, 'LEGACY_SPEECH_TAKE.txt');
      expect(fs.existsSync(sidecarTxt)).toBe(true);
      expect(fs.readFileSync(sidecarTxt, 'utf-8')).toBe(
        'Legacy in-registry transcript snippet that should be migrated to disk'
      );

      // Now save registry (or trigger any update) and inspect registry.json on disk
      sandboxDedup.updateVirtualClip('legacy-clip-1', { title: 'Updated Legacy Clip' });
      const rawSavedJson = fs.readFileSync(registryPath, 'utf-8');
      const parsedSaved = JSON.parse(rawSavedJson);

      // Verify registry.json is clean of transcript strings
      const savedClip = parsedSaved.virtualClips[0];
      expect(savedClip.transcription).toBeUndefined();
      expect(savedClip.fullTranscription).toBeUndefined();
      expect(savedClip.transcriptionChunks).toBeUndefined();
      expect(savedClip.transcriptPath).toBe(sidecarTxt);

      // Verify in-memory hydration still works
      const inMemoryClip = sandboxDedup.getVirtualClips()[0];
      expect(inMemoryClip.fullTranscription).toBe(
        'Legacy in-registry transcript snippet that should be migrated to disk'
      );
      expect(inMemoryClip.transcriptPath).toBe(sidecarTxt);

      // Verify reprocessClip works
      const sandboxWatcher = new VolumeWatcher(sandboxDedup);
      const sandboxAudio = new AudioEngine();
      const sandboxOrchestrator = new PipelineOrchestrator(sandboxDedup, sandboxWatcher, sandboxAudio);

      const job = sandboxOrchestrator.reprocessClip('legacy-clip-1');
      expect(job).toBeDefined();

      await new Promise<void>((resolve) => {
        sandboxOrchestrator.on('pipeline-status', (status) => {
          if (status.completedJobs >= 1) resolve();
        });
        setTimeout(resolve, 2000);
      });

      const reprocessed = sandboxDedup.getVirtualClip('legacy-clip-1');
      expect(reprocessed).toBeDefined();
      expect(reprocessed!.fullTranscription).toContain('simulated local whisper');
      expect(fs.existsSync(sidecarTxt)).toBe(true);

      // Verify reprocessAllClips works
      const batchRes = sandboxOrchestrator.reprocessAllClips(false);
      expect(batchRes).toBe(1);
    } finally {
      try {
        fs.rmSync(sandboxVaultDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('registers recording as playable immediately upon copy before transcription finishes (Slice F08)', async () => {
    const sandboxVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f08-vault-'));
    const sandboxSdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f08-sd-'));

    try {
      const testDedup = new DedupEngine(sandboxVaultDir);
      const testWatcher = new VolumeWatcher(testDedup);
      const testAudio = new AudioEngine();
      const testOrch = new PipelineOrchestrator(testDedup, testWatcher, testAudio);

      const speechTake = path.join(sandboxSdDir, 'F08_SPEECH_TAKE.WAV');
      fs.writeFileSync(speechTake, generateSyntheticWavBuffer({ durationSeconds: 1.5, frequency: 440 }));

      let readyFired = false;
      let readyClipId: string | null = null;
      let completedFired = false;

      testOrch.on('job-ready-to-play', (_job, clip) => {
        readyFired = true;
        readyClipId = clip.id;
        // Verify audio is already registered in registry and playable
        const storedClip = testDedup.getVirtualClip(clip.id);
        expect(storedClip).toBeDefined();
        expect(storedClip?.title).toBe('F08_SPEECH_TAKE');
        const parentRaw = testDedup.getRawFile(storedClip!.parentFileId);
        expect(parentRaw).toBeDefined();
        expect(parentRaw?.waveformPeaks.length).toBeGreaterThan(0);
        // Completed should NOT have fired yet when ready-to-play fires
        expect(completedFired).toBe(false);
      });

      testOrch.on('job-completed', () => {
        completedFired = true;
      });

      testOrch.enqueueBatch([speechTake], sandboxSdDir, undefined, true);

      await new Promise<void>((resolve) => {
        testOrch.on('pipeline-status', (status) => {
          if (status.completedJobs >= 1) resolve();
        });
        setTimeout(resolve, 4000);
      });

      expect(readyFired).toBe(true);
      expect(completedFired).toBe(true);

      const finalClip = testDedup.getVirtualClip(readyClipId!);
      expect(finalClip).toBeDefined();
      expect(finalClip?.transcription).toBeDefined();

      const finalStatus = testOrch.getStatus();
      expect(finalStatus.isSdCardActive).toBe(false);
      expect(finalStatus.canUnmountSdCard).toBe(true);
      expect(finalStatus.cardStatusText).toBeDefined();
    } finally {
      try {
        fs.rmSync(sandboxVaultDir, { recursive: true, force: true });
        fs.rmSync(sandboxSdDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('tracks import batches in persistent history and reconciles interrupted batches (Slice F09)', async () => {
    const sandboxVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f09-vault-'));
    const sandboxSrcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f09-src-'));

    try {
      const testDedup = new DedupEngine(sandboxVaultDir);
      const testWatcher = new VolumeWatcher(testDedup);
      const testAudio = new AudioEngine();
      const testOrch = new PipelineOrchestrator(testDedup, testWatcher, testAudio);

      const file1 = path.join(sandboxSrcDir, 'F09_TAKE1.WAV');
      const file2 = path.join(sandboxSrcDir, 'F09_TAKE2.WAV');
      fs.writeFileSync(file1, generateSyntheticWavBuffer({ durationSeconds: 0.5, frequency: 440 }));
      fs.writeFileSync(file2, generateSyntheticWavBuffer({ durationSeconds: 0.6, frequency: 880 }));

      const { batchId } = testOrch.enqueueBatch([file1, file2], undefined, 'Field Notes', true);

      // Verify batch record was created immediately
      const initialBatches = testDedup.getImportBatches();
      expect(initialBatches.length).toBe(1);
      expect(initialBatches[0].id).toBe(batchId);
      expect(initialBatches[0].targetCollection).toBe('Field Notes');
      expect(initialBatches[0].status).toBe('in_progress');
      expect(initialBatches[0].totalFiles).toBe(2);

      // Wait for pipeline completion
      await new Promise<void>((resolve) => {
        testOrch.on('pipeline-status', (status) => {
          if (status.completedJobs >= 2) resolve();
        });
        setTimeout(resolve, 4000);
      });

      // Verify batch record updated to completed with recordings
      const completedBatches = testDedup.getImportBatches();
      expect(completedBatches.length).toBe(1);
      expect(completedBatches[0].status).toBe('completed');
      expect(completedBatches[0].importedCount).toBe(2);
      expect(completedBatches[0].recordingIds.length).toBe(2);

      // Test reconciliation of interrupted batch
      testDedup.addImportBatch({
        id: 'interrupted-batch-1',
        sourceName: 'Interrupted SD',
        sourceType: 'sd_card',
        importedAt: new Date(Date.now() - 3600000).toISOString(),
        totalFiles: 3,
        importedCount: 1,
        duplicateCount: 0,
        excludedCount: 0,
        failedCount: 0,
        recordingIds: [completedBatches[0].recordingIds[0]], // Valid recording exists
        autoTranscribe: true,
        status: 'in_progress',
      });

      const reconciledCount = testOrch.reconcileInterruptedBatches();
      expect(reconciledCount).toBe(1);

      const reconciledBatch = testDedup.getImportBatches().find((b) => b.id === 'interrupted-batch-1');
      expect(reconciledBatch).toBeDefined();
      expect(reconciledBatch!.status).toBe('completed');
    } finally {
      try {
        fs.rmSync(sandboxVaultDir, { recursive: true, force: true });
        fs.rmSync(sandboxSrcDir, { recursive: true, force: true });
      } catch {}
    }
  });
});

