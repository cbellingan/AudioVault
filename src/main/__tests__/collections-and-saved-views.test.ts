import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DedupEngine } from '../dedup-engine';
import { generateFixtureVault } from '../../test/fixtures';
import { CollectionRecord, SavedViewRecord } from '../../shared/types';

describe('Slice F04: Collections, Batch Assignments, and Saved Views', () => {
  let tempDir: string;
  let engine: DedupEngine;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f04-test-sandbox-'));
    generateFixtureVault(tempDir, 20);
    engine = new DedupEngine(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('creates and retrieves custom collections without altering raw files', () => {
    const rawFilesBefore = fs.readdirSync(path.join(tempDir, 'raw'));

    const col1: CollectionRecord = {
      id: 'col-synth-1',
      name: 'Synthesizer Jams',
      color: '#6366f1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    engine.addCollection(col1);

    const cols = engine.getCollections();
    expect(cols.length).toBe(1);
    expect(cols[0].name).toBe('Synthesizer Jams');

    // Verify raw files on disk were untouched
    const rawFilesAfter = fs.readdirSync(path.join(tempDir, 'raw'));
    expect(rawFilesAfter).toEqual(rawFilesBefore);
  });

  it('supports many-to-many collection assignments across multiple recordings without copying audio', () => {
    const clips = engine.getVirtualClips();
    expect(clips.length).toBeGreaterThanOrEqual(3);

    const clipA = clips[0];
    const clipB = clips[1];

    // Assign clipA to two collections
    engine.addClipToCollection(clipA.id, 'Jazz Standards');
    engine.addClipToCollection(clipA.id, 'Live Sets');

    // Assign clipB to Live Sets
    engine.addClipToCollection(clipB.id, 'Live Sets');

    const updatedA = engine.getVirtualClip(clipA.id)!;
    const updatedB = engine.getVirtualClip(clipB.id)!;

    expect(updatedA.collections).toContain('Jazz Standards');
    expect(updatedA.collections).toContain('Live Sets');
    expect(updatedB.collections).toContain('Live Sets');
    expect(updatedB.collections).not.toContain('Jazz Standards');

    // Underlying audio files count remains identical
    const rawFiles = engine.getAllRawFiles();
    expect(rawFiles.length).toBe(20);
  });

  it('performs batch additions and removals from collections atomically', () => {
    const clips = engine.getVirtualClips().slice(0, 5);
    const clipIds = clips.map((c) => c.id);

    // Batch add to "Master Repertoire"
    const addedCount = engine.batchAddClipsToCollection(clipIds, 'Master Repertoire');
    expect(addedCount).toBe(5);

    for (const id of clipIds) {
      expect(engine.getVirtualClip(id)!.collections).toContain('Master Repertoire');
    }

    // Batch remove 2 clips
    const removedCount = engine.batchRemoveClipsFromCollection([clipIds[0], clipIds[1]], 'Master Repertoire');
    expect(removedCount).toBe(2);

    expect(engine.getVirtualClip(clipIds[0])!.collections).not.toContain('Master Repertoire');
    expect(engine.getVirtualClip(clipIds[1])!.collections).not.toContain('Master Repertoire');
    expect(engine.getVirtualClip(clipIds[2])!.collections).toContain('Master Repertoire');
  });

  it('renames a collection and propagates the new name to clips while leaving audio untouched', () => {
    const col: CollectionRecord = {
      id: 'col-field-rec',
      name: 'Field Takes',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    engine.addCollection(col);

    const clips = engine.getVirtualClips().slice(0, 3);
    for (const c of clips) {
      engine.addClipToCollection(c.id, 'Field Takes');
    }

    // Rename collection
    const renamed = engine.renameCollection('col-field-rec', 'Nature Ambience');
    expect(renamed).toBe(true);

    const cols = engine.getCollections();
    expect(cols.find((c) => c.id === 'col-field-rec')?.name).toBe('Nature Ambience');

    for (const c of clips) {
      const updated = engine.getVirtualClip(c.id)!;
      expect(updated.collections).toContain('Nature Ambience');
      expect(updated.collections).not.toContain('Field Takes');
    }
  });

  it('deletes a collection metadata record and clears references without deleting clips or raw audio', () => {
    const rawCountBefore = engine.getAllRawFiles().length;
    const clipCountBefore = engine.getVirtualClips().length;

    const col: CollectionRecord = {
      id: 'col-temp',
      name: 'Temporary Project',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    engine.addCollection(col);

    const firstClip = engine.getVirtualClips()[0];
    engine.addClipToCollection(firstClip.id, 'Temporary Project');
    expect(engine.getVirtualClip(firstClip.id)!.collections).toContain('Temporary Project');

    // Delete the collection
    const deleted = engine.deleteCollection('col-temp');
    expect(deleted).toBe(true);

    // Collection removed
    expect(engine.getCollections().find((c) => c.id === 'col-temp')).toBeUndefined();

    // Clip still exists, but reference is gone
    const afterClip = engine.getVirtualClip(firstClip.id)!;
    expect(afterClip).toBeDefined();
    expect(afterClip.collections).not.toContain('Temporary Project');

    // Audio files & clips count must be unchanged
    expect(engine.getAllRawFiles().length).toBe(rawCountBefore);
    expect(engine.getVirtualClips().length).toBe(clipCountBefore);
  });

  it('persists and deletes saved views accurately across registry reloads', () => {
    const view1: SavedViewRecord = {
      id: 'view-review-month',
      name: 'Monthly Review Queue',
      scope: 'review',
      groupBy: 'month',
      statusFilter: 'pending',
      searchQuery: 'acoustic',
      createdAt: new Date().toISOString(),
    };

    engine.addSavedView(view1);
    expect(engine.getSavedViews().length).toBe(1);

    // Reload engine from disk to verify persistence
    const reloaded = new DedupEngine(tempDir);
    const views = reloaded.getSavedViews();
    expect(views.length).toBe(1);
    expect(views[0].name).toBe('Monthly Review Queue');
    expect(views[0].groupBy).toBe('month');
    expect(views[0].statusFilter).toBe('pending');
    expect(views[0].searchQuery).toBe('acoustic');

    // Delete saved view
    reloaded.deleteSavedView('view-review-month');
    expect(reloaded.getSavedViews().length).toBe(0);

    const reloadedAfterDelete = new DedupEngine(tempDir);
    expect(reloadedAfterDelete.getSavedViews().length).toBe(0);
  });
});
