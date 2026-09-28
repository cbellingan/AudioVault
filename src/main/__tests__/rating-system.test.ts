import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DedupEngine } from '../dedup-engine';
import { generateFixtureVault } from '../../test/fixtures';

describe('Feature Slice 1: 0-5 Star Low-Friction Rating System', () => {
  let tempDir: string;
  let engine: DedupEngine;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rating-test-sandbox-'));
    generateFixtureVault(tempDir, 20);
    engine = new DedupEngine(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('sets clip rating within 0-5 bounds and synchronizes favorite state', () => {
    const clips = engine.getVirtualClips();
    expect(clips.length).toBeGreaterThan(0);
    const clip = clips[0];

    // Set rating to 4
    const res4 = engine.setClipRating(clip.id, 4);
    expect(res4).toBe(4);
    let updated = engine.getVirtualClip(clip.id)!;
    expect(updated.rating).toBe(4);
    expect(updated.favorite).toBe(true);

    // Set rating to 0 (clears rating and favorite)
    const res0 = engine.setClipRating(clip.id, 0);
    expect(res0).toBe(0);
    updated = engine.getVirtualClip(clip.id)!;
    expect(updated.rating).toBe(0);
    expect(updated.favorite).toBe(false);

    // Clamps negative numbers to 0
    const resNeg = engine.setClipRating(clip.id, -3);
    expect(resNeg).toBe(0);
    updated = engine.getVirtualClip(clip.id)!;
    expect(updated.rating).toBe(0);
    expect(updated.favorite).toBe(false);

    // Clamps numbers > 5 to 5
    const resOver = engine.setClipRating(clip.id, 10);
    expect(resOver).toBe(5);
    updated = engine.getVirtualClip(clip.id)!;
    expect(updated.rating).toBe(5);
    expect(updated.favorite).toBe(true);

    // Rounds fractional numbers (e.g. 3.7 -> 4)
    const resFrac = engine.setClipRating(clip.id, 3.7);
    expect(resFrac).toBe(4);
    updated = engine.getVirtualClip(clip.id)!;
    expect(updated.rating).toBe(4);
    expect(updated.favorite).toBe(true);
  });

  it('synchronizes favorite toggles with rating (0 <-> 5)', () => {
    const clips = engine.getVirtualClips();
    const clip = clips[0];

    // Ensure initial unrated
    engine.setClipRating(clip.id, 0);

    // Toggling favorite ON sets rating to 5
    const favOn = engine.toggleFavorite(clip.id);
    expect(favOn).toBe(true);
    let updated = engine.getVirtualClip(clip.id)!;
    expect(updated.favorite).toBe(true);
    expect(updated.rating).toBe(5);

    // Toggling favorite OFF sets rating to 0
    const favOff = engine.toggleFavorite(clip.id);
    expect(favOff).toBe(false);
    updated = engine.getVirtualClip(clip.id)!;
    expect(updated.favorite).toBe(false);
    expect(updated.rating).toBe(0);
  });

  it('migrates legacy clips without rating field during loadRegistry', () => {
    // Manually write registry with legacy clips missing rating
    const registryPath = path.join(tempDir, 'registry.json');
    const data = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

    // Inject legacy clip with favorite=true, rating missing
    const rawFileId = data.rawFiles[0].id;
    const legacyFavId = 'legacy-fav-clip';
    data.virtualClips.push({
      id: legacyFavId,
      parentFileId: rawFileId,
      title: 'Legacy Favorite Track',
      startTimeSeconds: 100,
      endTimeSeconds: 110,
      category: 'music',
      classificationConfidence: 0.9,
      classificationSource: 'yamnet_local',
      userTags: [],
      notes: '',
      favorite: true, // Legacy favorite without rating
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Inject legacy clip with favorite=false, rating missing
    const legacyUnfavId = 'legacy-unfav-clip';
    data.virtualClips.push({
      id: legacyUnfavId,
      parentFileId: rawFileId,
      title: 'Legacy Unfavorited Track',
      startTimeSeconds: 120,
      endTimeSeconds: 125,
      category: 'music',
      classificationConfidence: 0.8,
      classificationSource: 'yamnet_local',
      userTags: [],
      notes: '',
      favorite: false, // Legacy unfav without rating
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    fs.writeFileSync(registryPath, JSON.stringify(data, null, 2), 'utf8');

    // Reload engine
    const reloadedEngine = new DedupEngine(tempDir);
    const loadedFav = reloadedEngine.getVirtualClip(legacyFavId);
    expect(loadedFav).toBeDefined();
    expect(loadedFav!.rating).toBe(5);
    expect(loadedFav!.favorite).toBe(true);

    const loadedUnfav = reloadedEngine.getVirtualClip(legacyUnfavId);
    expect(loadedUnfav).toBeDefined();
    expect(loadedUnfav!.rating).toBe(0);
    expect(loadedUnfav!.favorite).toBe(false);
  });

  it('persists rating updates across engine restarts', () => {
    const clips = engine.getVirtualClips();
    const clip = clips[1];

    engine.setClipRating(clip.id, 3);
    expect(engine.getVirtualClip(clip.id)!.rating).toBe(3);

    // Create fresh DedupEngine instance to read from disk
    const freshEngine = new DedupEngine(tempDir);
    const persisted = freshEngine.getVirtualClip(clip.id);
    expect(persisted).toBeDefined();
    expect(persisted!.rating).toBe(3);
    expect(persisted!.favorite).toBe(true);
  });

  it('updates rating and favorite via updateVirtualClip', () => {
    const clips = engine.getVirtualClips();
    const clip = clips[2];

    // Update with rating=2
    const updated = engine.updateVirtualClip(clip.id, { rating: 2 });
    expect(updated).toBeDefined();
    expect(updated!.rating).toBe(2);
    expect(updated!.favorite).toBe(true);

    // Update with rating=0
    const cleared = engine.updateVirtualClip(clip.id, { rating: 0 });
    expect(cleared).toBeDefined();
    expect(cleared!.rating).toBe(0);
    expect(cleared!.favorite).toBe(false);
  });
});
