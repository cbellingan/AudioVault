import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { DedupEngine } from '../dedup-engine';
import { CollectionRecord, ImportBatchRecord, SavedViewRecord } from '../../shared/types';

describe('Slice F01: Versioned Domain and Atomic Migration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f01-domain-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('migrates a legacy V2 fixture to V3 with automatic backup and identical idempotent re-migration', () => {
    const registryFile = path.join(tempDir, 'registry.json');
    const rawDir = path.join(tempDir, 'raw');
    fs.mkdirSync(rawDir, { recursive: true });

    // Create legacy V2 registry fixture
    const legacyRegistry = {
      version: 2,
      rawFiles: [
        {
          id: 'raw_legacy_01',
          fingerprint: 'fp_legacy_01_hash',
          originalFilename: 'LEGACY_INTERVIEW.WAV',
          storagePath: path.join(rawDir, 'LEGACY_INTERVIEW.WAV'),
          durationSeconds: 125.5,
          sampleRate: 44100,
          channels: 1,
          fileSizeBytes: 1048576,
          sourceDevice: 'Zoom H1',
          importedAt: '2026-08-01T12:00:00.000Z',
          waveformPeaks: [0.1, 0.5, 0.8],
        },
      ],
      virtualClips: [
        {
          id: 'clip_legacy_01',
          parentFileId: 'raw_legacy_01',
          title: 'Legacy User Interview #1',
          startTimeSeconds: 0,
          endTimeSeconds: 125.5,
          category: 'meeting',
          userTags: ['Research', 'User Interview'],
          classificationConfidence: 0.88,
          classificationSource: 'yamnet_local',
          transcription: '[Whisper]: "We spoke with the user about navigation"',
          fullTranscription: 'We spoke with the user about navigation',
          notes: 'Legacy user note',
          isExcluded: false,
          createdAt: '2026-08-01T12:00:00.000Z',
          updatedAt: '2026-08-01T12:00:00.000Z',
        },
      ],
      deletedFiles: [],
      settings: {
        vaultDirectory: tempDir,
        autoUnmountAfterIngest: true,
        useLocalModelsDefault: true,
        enableCloudFallback: false,
        whisperLanguage: 'en',
      },
    };

    fs.writeFileSync(registryFile, JSON.stringify(legacyRegistry, null, 2), 'utf-8');

    // First load / migration
    const engine1 = new DedupEngine(tempDir);
    expect(fs.existsSync(`${registryFile}.v2.bak`)).toBe(true);
    expect(fs.existsSync(`${registryFile}.bak`)).toBe(true);

    const clips1 = engine1.getVirtualClips();
    expect(clips1.length).toBe(1);
    const clip1 = clips1[0];
    expect(clip1.id).toBe('clip_legacy_01');
    expect(clip1.title).toBe('Legacy User Interview #1');
    expect(clip1.notes).toBe('Legacy user note');
    expect(clip1.reviewed).toBe(false); // default review state
    expect(clip1.favorite).toBe(false); // default favorite state
    expect(clip1.collections).toEqual([]); // collections initialized
    expect(clip1.recordedAt).toBeUndefined(); // unknown recorded date is NOT fabricated!

    // Verify sidecar was created and registry on disk is V3
    const diskContent1 = JSON.parse(fs.readFileSync(registryFile, 'utf-8'));
    expect(diskContent1.version).toBe(3);
    expect(Array.isArray(diskContent1.collections)).toBe(true);
    expect(Array.isArray(diskContent1.importBatches)).toBe(true);
    expect(Array.isArray(diskContent1.savedViews)).toBe(true);

    // Second load: idempotent re-migration produces identical results
    const engine2 = new DedupEngine(tempDir);
    const clips2 = engine2.getVirtualClips();
    expect(clips2.length).toBe(1);
    expect(clips2[0].id).toBe('clip_legacy_01');
    expect(clips2[0].reviewed).toBe(false);
    expect(clips2[0].favorite).toBe(false);

    const diskContent2 = JSON.parse(fs.readFileSync(registryFile, 'utf-8'));
    expect(diskContent2.version).toBe(3);
    expect(diskContent2.virtualClips[0].id).toBe('clip_legacy_01');
  });

  it('recovers from corrupt/interrupted registry write using .bak file', () => {
    const registryFile = path.join(tempDir, 'registry.json');
    const engine = new DedupEngine(tempDir);

    // Add a collection and batch
    const col: CollectionRecord = {
      id: 'col_01',
      name: 'User Studies',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    engine.addCollection(col);
    expect(engine.getCollections().length).toBe(1);

    // Corrupt registry.json simulates power failure/crash during write
    fs.writeFileSync(registryFile, '{"version": 3, "rawFiles": [TRUNCATED_CORRUPT_JSON', 'utf-8');

    // Fresh DedupEngine should restore from .bak
    const recoveredEngine = new DedupEngine(tempDir);
    expect(recoveredEngine.getCollections().length).toBe(1);
    expect(recoveredEngine.getCollections()[0].name).toBe('User Studies');
  });

  it('preserves corrupt file as .corrupt.<timestamp> if no valid backup exists without crashing', () => {
    const registryFile = path.join(tempDir, 'registry.json');
    fs.writeFileSync(registryFile, '{ INVALID_JSON_NO_BACKUP', 'utf-8');

    const engine = new DedupEngine(tempDir);
    expect(engine.getAllRawFiles().length).toBe(0);

    // Verify .corrupt file was archived
    const files = fs.readdirSync(tempDir);
    expect(files.some((f) => f.includes('.corrupt.'))).toBe(true);
  });

  it('manages collections, import batches, saved views, and clip memberships', () => {
    const engine = new DedupEngine(tempDir);

    // 1. Collections
    const col1: CollectionRecord = {
      id: 'col_album',
      name: 'Album Sessions',
      isPinned: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    engine.addCollection(col1);
    expect(engine.getCollections().length).toBe(1);
    expect(engine.getCollections()[0].isPinned).toBe(true);

    // 2. Import Batches
    const batch: ImportBatchRecord = {
      id: 'batch_01',
      sourceName: 'Zoom H1 SD Card',
      sourceType: 'sd_card',
      importedAt: new Date().toISOString(),
      totalFiles: 12,
      importedCount: 10,
      duplicateCount: 2,
      excludedCount: 0,
      failedCount: 0,
      recordingIds: ['raw_01', 'raw_02'],
      autoTranscribe: true,
      status: 'completed',
    };
    engine.addImportBatch(batch);
    expect(engine.getImportBatches().length).toBe(1);

    // 3. Saved Views
    const view: SavedViewRecord = {
      id: 'view_unreviewed',
      name: 'Needs Review',
      scope: 'review',
      groupBy: 'date',
      statusFilter: 'all',
      createdAt: new Date().toISOString(),
    };
    engine.addSavedView(view);
    expect(engine.getSavedViews().length).toBe(1);

    // 4. Clip membership and flags
    const clip = {
      id: 'clip_flag_test',
      parentFileId: 'raw_flag_test',
      title: 'Flag Test Take',
      startTimeSeconds: 0,
      endTimeSeconds: 60,
      category: 'music' as const,
      userTags: ['Take'],
      classificationConfidence: 0.9,
      classificationSource: 'yamnet_local' as const,
      isExcluded: false,
      createdAt: '2026-09-15T10:00:00.000Z',
      updatedAt: '2026-09-15T10:00:00.000Z',
    };
    engine.addVirtualClip(clip);

    // Test favorite toggle
    expect(engine.toggleFavorite('clip_flag_test')).toBe(true);
    expect(engine.getVirtualClip('clip_flag_test')?.favorite).toBe(true);
    expect(engine.toggleFavorite('clip_flag_test')).toBe(false);

    // Test reviewed toggle
    expect(engine.toggleReviewed('clip_flag_test')).toBe(true);
    expect(engine.getVirtualClip('clip_flag_test')?.reviewed).toBe(true);

    // Test many-to-many collections
    engine.addClipToCollection('clip_flag_test', 'Album Sessions');
    engine.addClipToCollection('clip_flag_test', 'Favorites 2026');
    const updatedClip = engine.getVirtualClip('clip_flag_test');
    expect(updatedClip?.collections).toContain('Album Sessions');
    expect(updatedClip?.collections).toContain('Favorites 2026');

    // Remove from one collection
    engine.removeClipFromCollection('clip_flag_test', 'Album Sessions');
    expect(engine.getVirtualClip('clip_flag_test')?.collections).not.toContain('Album Sessions');
    expect(engine.getVirtualClip('clip_flag_test')?.collections).toContain('Favorites 2026');

    // Reload from disk to verify persistence of all domain extensions
    const reloaded = new DedupEngine(tempDir);
    expect(reloaded.getCollections().length).toBe(1);
    expect(reloaded.getImportBatches().length).toBe(1);
    expect(reloaded.getSavedViews().length).toBe(1);
    const persistedClip = reloaded.getVirtualClip('clip_flag_test');
    expect(persistedClip?.reviewed).toBe(true);
    expect(persistedClip?.collections).toEqual(['Favorites 2026']);
  });
});
