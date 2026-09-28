import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DedupEngine } from '../dedup-engine';
import { generateFixtureVault } from '../../test/fixtures';

describe('Feature Slice 3: Metadata Copy/Paste and Map Geolocation', () => {
  let tempDir: string;
  let engine: DedupEngine;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadata-copypaste-test-'));
    generateFixtureVault(tempDir, 20);
    engine = new DedupEngine(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('copies artist and location metadata from source clip and pastes onto single target clip', () => {
    const clips = engine.getVirtualClips();
    expect(clips.length).toBeGreaterThanOrEqual(2);

    const sourceClip = clips[0];
    const targetClip = clips[1];

    // Setup source metadata
    engine.updateVirtualClip(sourceClip.id, {
      artist: 'Snarky Puppy',
      location: 'GroundUP Music Festival, Miami',
    });

    const refreshedSource = engine.getVirtualClip(sourceClip.id)!;
    expect(refreshedSource.artist).toBe('Snarky Puppy');
    expect(refreshedSource.location).toBe('GroundUP Music Festival, Miami');

    // Simulate Copy action
    const clipboardPayload = {
      type: 'audiovault/metadata',
      artist: refreshedSource.artist,
      location: refreshedSource.location,
    };

    // Simulate Paste action onto target clip
    const updatedClips = engine.batchUpdateMetadata([targetClip.id], {
      artist: clipboardPayload.artist,
      location: clipboardPayload.location,
    });

    expect(updatedClips.length).toBe(1);
    expect(updatedClips[0].id).toBe(targetClip.id);
    expect(updatedClips[0].artist).toBe('Snarky Puppy');
    expect(updatedClips[0].location).toBe('GroundUP Music Festival, Miami');

    // Verify persistence across reload
    const freshEngine = new DedupEngine(tempDir);
    const persistedTarget = freshEngine.getVirtualClip(targetClip.id)!;
    expect(persistedTarget.artist).toBe('Snarky Puppy');
    expect(persistedTarget.location).toBe('GroundUP Music Festival, Miami');
  });

  it('copies metadata and batch pastes onto multiple selected clips simultaneously', () => {
    const clips = engine.getVirtualClips();
    expect(clips.length).toBeGreaterThanOrEqual(4);

    const [source, target1, target2, target3] = clips;

    engine.updateVirtualClip(source.id, {
      artist: 'Bill Evans Trio',
      location: 'Village Vanguard, NYC',
    });

    const refreshedSource = engine.getVirtualClip(source.id)!;
    const updates = {
      artist: refreshedSource.artist,
      location: refreshedSource.location,
    };

    const targetIds = [target1.id, target2.id, target3.id];
    const results = engine.batchUpdateMetadata(targetIds, updates);

    expect(results.length).toBe(3);
    for (const res of results) {
      expect(res.artist).toBe('Bill Evans Trio');
      expect(res.location).toBe('Village Vanguard, NYC');
    }

    // Verify in registry
    for (const id of targetIds) {
      const persisted = engine.getVirtualClip(id)!;
      expect(persisted.artist).toBe('Bill Evans Trio');
      expect(persisted.location).toBe('Village Vanguard, NYC');
    }
  });

  it('preserves existing target metadata if copied payload has empty or unspecified fields', () => {
    const clips = engine.getVirtualClips();
    const [source, target] = clips;

    // Target initially has location
    engine.updateVirtualClip(target.id, {
      artist: 'Old Artist',
      location: 'Pre-existing Venue',
    });

    // Source only has artist
    engine.updateVirtualClip(source.id, {
      artist: 'New Artist Only',
    });

    const refreshedSource = engine.getVirtualClip(source.id)!;
    expect(refreshedSource.artist).toBe('New Artist Only');
    expect(refreshedSource.location).toBeUndefined();

    // Paste only non-empty fields
    const updates: { artist?: string; location?: string } = {};
    if (refreshedSource.artist) updates.artist = refreshedSource.artist;
    if (refreshedSource.location) updates.location = refreshedSource.location;

    const results = engine.batchUpdateMetadata([target.id], updates);
    expect(results[0].artist).toBe('New Artist Only');
    expect(results[0].location).toBe('Pre-existing Venue'); // Preserved!
  });

  it('formats Google Maps embed and search URLs correctly for places and coordinates', () => {
    // Coordinate-based query
    const lat = 51.5321;
    const lng = -0.1778;
    const embedUrlWithCoords = `https://maps.google.com/maps?q=${lat},${lng}&t=&z=15&ie=UTF8&iwloc=&output=embed`;
    const searchUrlWithCoords = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

    expect(embedUrlWithCoords).toContain('q=51.5321,-0.1778');
    expect(embedUrlWithCoords).toContain('output=embed');
    expect(searchUrlWithCoords).toBe('https://www.google.com/maps/search/?api=1&query=51.5321,-0.1778');

    // Query text based
    const query = 'Abbey Road Studios, London';
    const embedUrlWithQuery = `https://maps.google.com/maps?q=${encodeURIComponent(query)}&t=&z=14&ie=UTF8&iwloc=&output=embed`;
    const searchUrlWithQuery = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

    expect(embedUrlWithQuery).toContain('q=Abbey%20Road%20Studios%2C%20London');
    expect(embedUrlWithQuery).toContain('output=embed');
    expect(searchUrlWithQuery).toBe('https://www.google.com/maps/search/?api=1&query=Abbey%20Road%20Studios%2C%20London');
  });

  it('serializes and deserializes clipboard JSON payload faithfully', () => {
    const payload = {
      type: 'audiovault/metadata',
      artist: 'Pink Floyd',
      location: 'Pompeii Amphitheatre, Italy',
    };

    const serialized = JSON.stringify(payload, null, 2);
    const parsed = JSON.parse(serialized);

    expect(parsed.type).toBe('audiovault/metadata');
    expect(parsed.artist).toBe('Pink Floyd');
    expect(parsed.location).toBe('Pompeii Amphitheatre, Italy');
  });
});
