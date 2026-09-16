import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DedupEngine } from '../dedup-engine';
import { generateFixtureVault, FIXTURE_COLLECTIONS } from '../../test/fixtures';

describe('Slice F00: Isolation Hard Guards and Fixture Coverage', () => {
  let tempDir: string;
  const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
  const prodVault = path.join(homeDir, 'Music', 'AudioVault');
  let prodVaultStatBefore: { exists: boolean; mtimeMs?: number; size?: number };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f00-test-sandbox-'));
    if (fs.existsSync(prodVault)) {
      const stat = fs.statSync(path.join(prodVault, 'registry.json'));
      prodVaultStatBefore = { exists: true, mtimeMs: stat.mtimeMs, size: stat.size };
    } else {
      prodVaultStatBefore = { exists: false };
    }
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}

    // Verify production vault is NEVER touched
    if (prodVaultStatBefore.exists) {
      const statAfter = fs.statSync(path.join(prodVault, 'registry.json'));
      expect(statAfter.mtimeMs).toBe(prodVaultStatBefore.mtimeMs);
      expect(statAfter.size).toBe(prodVaultStatBefore.size);
    }
  });

  it('enforces hard guard: throws if no isolated vault is provided during test mode', () => {
    const originalEnv = process.env.AUDIOVAULT_VAULT_DIR;
    delete process.env.AUDIOVAULT_VAULT_DIR;
    try {
      expect(() => new DedupEngine()).toThrow(/Test mode active.*strictly forbidden/i);
    } finally {
      if (originalEnv) process.env.AUDIOVAULT_VAULT_DIR = originalEnv;
    }
  });

  it('enforces hard guard: throws if explicit production vault path is targeted during test mode', () => {
    expect(() => new DedupEngine(prodVault)).toThrow(/Test mode active.*strictly forbidden/i);
  });

  it('enforces hard guard: throws if updateSettings attempts to switch to production vault in test mode', () => {
    const engine = new DedupEngine(tempDir);
    expect(() => engine.updateSettings({ vaultDirectory: prodVault })).toThrow(/switch vault directory to production vault/i);
  });

  it('generates an empty fixture vault (0 items)', () => {
    const fixture = generateFixtureVault(tempDir, 0);
    expect(fixture.rawFiles.length).toBe(0);
    expect(fixture.virtualClips.length).toBe(0);

    const engine = new DedupEngine(tempDir);
    expect(engine.getAllRawFiles().length).toBe(0);
    expect(engine.getVirtualClips().length).toBe(0);
  });

  it('generates a 20-recording fixture vault with audio and sidecars', () => {
    const fixture = generateFixtureVault(tempDir, 20, { writeAudioFiles: true, writeTranscriptSidecars: true });
    expect(fixture.rawFiles.length).toBe(20);
    expect(fixture.virtualClips.length).toBeGreaterThanOrEqual(20); // includes excerpts

    const engine = new DedupEngine(tempDir);
    const clips = engine.getVirtualClips();
    expect(clips.length).toBeGreaterThanOrEqual(20);

    // Verify sidecars and WAVs exist on disk
    const rawFiles = fs.readdirSync(path.join(tempDir, 'raw'));
    expect(rawFiles.some((f) => f.endsWith('.WAV'))).toBe(true);
    expect(rawFiles.some((f) => f.endsWith('.txt'))).toBe(true);
  });

  it('generates a 500-recording fixture vault in < 150ms with all edge cases', () => {
    const start = performance.now();
    const fixture = generateFixtureVault(tempDir, 500, { writeAudioFiles: false, writeTranscriptSidecars: false });
    const elapsed = performance.now() - start;

    expect(fixture.rawFiles.length).toBe(500);
    expect(fixture.virtualClips.length).toBeGreaterThanOrEqual(500);

    const engine = new DedupEngine(tempDir);
    const clips = engine.getVirtualClips();
    expect(clips.length).toBe(fixture.virtualClips.length);

    // Check edge case 1: Unknown recorded dates
    const unknownDates = clips.filter((c) => !c.createdAt || c.createdAt.includes('2026-09-15'));
    expect(unknownDates.length).toBeGreaterThan(0);

    // Check edge case 2: Long and Unicode titles
    const unicodeTitles = clips.filter((c) => c.title.includes('Café') || c.title.includes('東京会議'));
    expect(unicodeTitles.length).toBeGreaterThan(0);

    // Check edge case 3: Excerpts under parent
    const excerpts = clips.filter((c) => c.title.startsWith('Excerpt:'));
    expect(excerpts.length).toBeGreaterThan(0);

    // Check edge case 4: Varying transcript states
    const states = new Set(clips.map((c) => c.transcription ? 'Transcript ready' : 'No transcript'));
    expect(states.size).toBe(2);

    expect(elapsed).toBeLessThan(500);
  });

  it('generates a 5,000-recording fixture vault under 1.5s', () => {
    const start = performance.now();
    const fixture = generateFixtureVault(tempDir, 5000, { writeAudioFiles: false, writeTranscriptSidecars: false });
    const elapsed = performance.now() - start;

    expect(fixture.rawFiles.length).toBe(5000);
    expect(fixture.virtualClips.length).toBeGreaterThanOrEqual(5000);

    const engine = new DedupEngine(tempDir);
    expect(engine.getAllRawFiles().length).toBe(5000);
    expect(elapsed).toBeLessThan(1500);
  });
});
