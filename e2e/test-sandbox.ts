import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { _electron as electron } from "@playwright/test";
import { generateSyntheticWavBuffer } from "../src/test/audio-fixture";
import { PrimaryCategory, RawAudioFile, VirtualClip, VaultSettings } from "../src/shared/types";

export interface SandboxContext {
  sandboxDir: string;
  rawDir: string;
  exportsDir: string;
  userDataDir: string;
  registryPath: string;
}

export function getProductionVaultStat(): { exists: boolean; mtimeMs?: number; size?: number } {
  const home = process.env.HOME || process.env.USERPROFILE || ".";
  const prodRegistry = path.join(home, "Music", "AudioVault", "registry.json");
  if (fs.existsSync(prodRegistry)) {
    const stat = fs.statSync(prodRegistry);
    return { exists: true, mtimeMs: stat.mtimeMs, size: stat.size };
  }
  return { exists: false };
}

export function setupTestSandbox(): SandboxContext {
  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "audiovault-e2e-sandbox-"));
  const rawDir = path.join(sandboxDir, "raw");
  const exportsDir = path.join(sandboxDir, "exports");
  const userDataDir = path.join(sandboxDir, "userdata");
  const registryPath = path.join(sandboxDir, "registry.json");

  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(exportsDir, { recursive: true });
  fs.mkdirSync(userDataDir, { recursive: true });

  const testFiles = [
    {
      id: "raw_01",
      filename: "ZOOM0001_WARMUPS.WAV",
      title: "ZOOM0001 - Harmony Warmups",
      category: "music" as PrimaryCategory,
      tags: ["Vocal Warmup", "Soprano Practice"],
      options: { durationSeconds: 2.5, frequency: 440 },
    },
    {
      id: "raw_02",
      filename: "ZOOM0002_ACOUSTIC.WAV",
      title: "ZOOM0002 - Acoustic Set Take 1",
      category: "concerts" as PrimaryCategory,
      tags: ["Live Set", "Acoustic Guitar"],
      options: { durationSeconds: 3.0, frequency: 880 },
    },
    {
      id: "raw_03",
      filename: "STE-003_STANDUP.WAV",
      title: "STE-003 - Product Standup",
      category: "meeting" as PrimaryCategory,
      tags: ["Sprint Planning", "Engineering"],
      transcript: "[Local Whisper]: \"...the audio pipeline handles unmounting cleanly...\"",
      options: { durationSeconds: 4.0, isPulsedSpeech: true },
    },
    {
      id: "raw_04",
      filename: "ZOOM0004_MELODIC.WAV",
      title: "ZOOM0004 - Quick Melodic Idea",
      category: "dictaphone" as PrimaryCategory,
      tags: ["Voice Memo", "Song Idea"],
      transcript: "[Local Whisper]: \"...chord progression in D minor...\"",
      options: { durationSeconds: 2.0, isPulsedSpeech: true },
    },
    {
      id: "raw_05",
      filename: "260831-185613.WAV",
      title: "260831-185613",
      category: "dictaphone" as PrimaryCategory,
      tags: ["Voice Memo"],
      transcript: "Testing one two three local transcription works beautifully",
      options: { durationSeconds: 3.5, isPulsedSpeech: true },
    },
    {
      id: "raw_06",
      filename: "ZOOM0006_AMBIENCE.WAV",
      title: "ZOOM0006 - Forest Rain Ambience",
      category: "ambient" as PrimaryCategory,
      tags: ["Nature", "Field Recording"],
      options: { durationSeconds: 4.0, frequency: 220 },
    },
    {
      id: "raw_07",
      filename: "ZOOM0007_FEELINGS.WAV",
      title: "ZOOM0007 - Feelings In The Rain",
      category: "music" as PrimaryCategory,
      tags: ["Vocal", "Soul"],
      options: { durationSeconds: 2.8, frequency: 520 },
    },
  ];

  const rawFiles: RawAudioFile[] = [];
  const virtualClips: VirtualClip[] = [];

  for (let i = 0; i < testFiles.length; i++) {
    const tf = testFiles[i];
    const filePath = path.join(rawDir, tf.filename);
    const wavBuffer = generateSyntheticWavBuffer(tf.options);
    fs.writeFileSync(filePath, wavBuffer);

    const hash = crypto.createHash("sha256").update(wavBuffer).digest("hex");
    const stats = fs.statSync(filePath);

    rawFiles.push({
      id: tf.id,
      storagePath: filePath,
      originalFilename: tf.filename,
      fileSizeBytes: stats.size,
      fingerprint: hash,
      sourceDevice: "Test Sandbox SD",
      importedAt: new Date(Date.now() - (i + 1) * 3600000).toISOString(),
      channels: 1,
      sampleRate: 44100,
      durationSeconds: tf.options.durationSeconds,
      waveformPeaks: Array.from({ length: 60 }, () => Math.random() * 0.6 + 0.2),
    });

    virtualClips.push({
      id: `clip_0${i + 1}`,
      parentFileId: tf.id,
      title: tf.title,
      startTimeSeconds: 0,
      endTimeSeconds: tf.options.durationSeconds,
      category: tf.category,
      userTags: tf.tags,
      classificationConfidence: 0.9,
      classificationSource: "yamnet_local",
      transcription: tf.transcript,
      isExcluded: false,
      createdAt: new Date(Date.now() - (i + 1) * 3600000).toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  const settings: VaultSettings = {
    vaultDirectory: sandboxDir,
    autoUnmountAfterIngest: true,
    useLocalModelsDefault: true,
    enableCloudFallback: false,
    whisperLanguage: "en",
    rememberDeleteChoice: false,
  };

  const registry = {
    version: 2,
    rawFiles,
    virtualClips,
    deletedFiles: [],
    settings,
  };

  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), "utf8");

  return {
    sandboxDir,
    rawDir,
    exportsDir,
    userDataDir,
    registryPath,
  };
}

export function teardownTestSandbox(sandbox: SandboxContext) {
  try {
    fs.rmSync(sandbox.sandboxDir, { recursive: true, force: true });
  } catch {}
}

export async function launchTestApp(sandbox: SandboxContext) {
  const app = await electron.launch({
    args: [
      path.join(__dirname, "../dist-electron/main/index.js"),
      `--vault-dir=${sandbox.sandboxDir}`,
    ],
    env: {
      ...process.env,
      AUDIOVAULT_VAULT_DIR: sandbox.sandboxDir,
      AUDIOVAULT_USER_DATA_DIR: sandbox.userDataDir,
      AUDIOVAULT_TEST_MODE: "1",
    },
  });

  return app;
}
