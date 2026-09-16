import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { DedupEngine } from "../dedup-engine";
import { VolumeWatcher } from "../volume-watcher";
import { AudioEngine } from "../audio-engine";
import { PipelineOrchestrator } from "../pipeline-orchestrator";
import { generateSyntheticWavBuffer } from "../../test/audio-fixture";
import { RawAudioFile, VirtualClip } from "../../shared/types";

describe("Recording Capture Integration (Slice F13)", () => {
  let sandboxDir: string;
  let dedupEngine: DedupEngine;
  let volumeWatcher: VolumeWatcher;
  let audioEngine: AudioEngine;
  let pipelineOrchestrator: PipelineOrchestrator;

  beforeEach(() => {
    process.env.AUDIOVAULT_TEST_MODE = "1";
    sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "audiovault-rec-capture-test-"));
    dedupEngine = new DedupEngine(sandboxDir);
    volumeWatcher = new VolumeWatcher(dedupEngine);
    audioEngine = new AudioEngine();
    pipelineOrchestrator = new PipelineOrchestrator(dedupEngine, volumeWatcher, audioEngine);
  });

  afterEach(() => {
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch {}
  });

  it("saves recorded take synchronously into sandbox raw/ directory with custom title and destination collection", () => {
    const rawDir = dedupEngine.getRawDir();
    const timestamp = Date.now();
    const filename = `${timestamp}_recording.WAV`;
    const filePath = path.join(rawDir, filename);

    const wavBuffer = generateSyntheticWavBuffer({ durationSeconds: 0.5, frequency: 440 });
    fs.writeFileSync(filePath, wavBuffer);

    expect(fs.existsSync(filePath)).toBe(true);

    const analysis = audioEngine.analyzeWavFile(filePath);
    const fingerprint = dedupEngine.computeFileFingerprint(filePath);
    const rawFileId = `raw_${timestamp}_rec`;
    const rawAudioRecord: RawAudioFile = {
      id: rawFileId,
      fingerprint,
      originalFilename: filename,
      storagePath: filePath,
      durationSeconds: analysis.features.durationSeconds,
      sampleRate: analysis.features.sampleRate,
      channels: analysis.features.channels,
      fileSizeBytes: wavBuffer.length,
      sourceDevice: "In-App Recorder",
      importedAt: new Date().toISOString(),
      waveformPeaks: analysis.peaks,
    };
    dedupEngine.addRawFile(rawAudioRecord);

    const clipId = `clip_${timestamp}_rec`;
    const customTitle = "Guitar Idea Take 1";
    const targetCollection = "Songwriting 2026";

    const defaultClip: VirtualClip = {
      id: clipId,
      parentFileId: rawFileId,
      title: customTitle,
      startTimeSeconds: 0,
      endTimeSeconds: analysis.features.durationSeconds,
      category: "music",
      userTags: ["In-App Take", "Voice Memo"],
      collections: [targetCollection],
      classificationConfidence: 0.95,
      classificationSource: "yamnet_local",
      isExcluded: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    dedupEngine.addVirtualClip(defaultClip);
    dedupEngine.addClipToCollection(defaultClip.id, targetCollection);

    // Verify clip is saved with title and collection
    const saved = dedupEngine.getVirtualClip(clipId);
    expect(saved).toBeDefined();
    expect(saved?.title).toBe("Guitar Idea Take 1");
    expect(saved?.collections).toContain("Songwriting 2026");

    // Verify clips list has the collection assigned
    const allClips = dedupEngine.getVirtualClips();
    expect(allClips.some((c) => c.id === clipId && c.collections?.includes("Songwriting 2026"))).toBe(true);
  });

  it("enqueues recorded take into PipelineOrchestrator preserving destination collection", () => {
    const rawDir = dedupEngine.getRawDir();
    const filePath = path.join(rawDir, "in_app_memo.wav");
    const wavBuffer = generateSyntheticWavBuffer({ durationSeconds: 0.5, frequency: 520 });
    fs.writeFileSync(filePath, wavBuffer);

    const customTitle = "Meeting Field Note";
    const targetCollection = "Field Research 2026";

    const job = pipelineOrchestrator.enqueueLocalFile(
      filePath,
      customTitle,
      "In-App Recorder",
      undefined,
      undefined,
      targetCollection
    );

    expect(job).toBeDefined();
    expect(["queued_analysis", "analyzing", "completed"]).toContain(job?.stage);
    expect((job as any).targetCollection).toBe("Field Research 2026");
  });

  it("does not touch production vault during recording capture operations", () => {
    const homeDir = process.env.HOME || process.env.USERPROFILE || ".";
    const prodVault = path.join(homeDir, "Music", "AudioVault");
    expect(dedupEngine.getVaultDir()).not.toBe(prodVault);
    expect(dedupEngine.getVaultDir().startsWith(os.tmpdir())).toBe(true);
  });
});
