import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DedupEngine } from '../dedup-engine';
import { TaggerService } from '../tagger-service';
import { generateFixtureVault } from '../../test/fixtures';

describe('Feature Slice 2: Artist & Location Metadata, Dropdown Memory, and In-File Tagging', () => {
  let tempDir: string;
  let engine: DedupEngine;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadata-test-sandbox-'));
    generateFixtureVault(tempDir, 20);
    engine = new DedupEngine(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('updates artist and location on virtual clips and persists to registry', () => {
    const clips = engine.getVirtualClips();
    expect(clips.length).toBeGreaterThan(0);
    const clip = clips[0];

    const updated = engine.updateVirtualClip(clip.id, {
      artist: 'Miles Davis',
      location: 'Columbia 30th Street Studio, NYC',
    });

    expect(updated).toBeDefined();
    expect(updated!.artist).toBe('Miles Davis');
    expect(updated!.location).toBe('Columbia 30th Street Studio, NYC');

    // Verify persistence across reload
    const freshEngine = new DedupEngine(tempDir);
    const persisted = freshEngine.getVirtualClip(clip.id);
    expect(persisted).toBeDefined();
    expect(persisted!.artist).toBe('Miles Davis');
    expect(persisted!.location).toBe('Columbia 30th Street Studio, NYC');
  });

  it('collects and deduplicates known artists and locations for dropdown memory', () => {
    const clips = engine.getVirtualClips();
    expect(clips.length).toBeGreaterThanOrEqual(3);

    engine.updateVirtualClip(clips[0].id, { artist: 'Herbie Hancock', location: 'Blue Note Club' });
    engine.updateVirtualClip(clips[1].id, { artist: 'Wayne Shorter', location: 'Village Vanguard' });
    engine.updateVirtualClip(clips[2].id, { artist: 'Herbie Hancock', location: 'Blue Note Club' }); // Duplicate

    const knownArtists = engine.getKnownArtists();
    const knownLocations = engine.getKnownLocations();

    expect(knownArtists).toContain('Herbie Hancock');
    expect(knownArtists).toContain('Wayne Shorter');
    expect(knownArtists.filter((a) => a === 'Herbie Hancock').length).toBe(1);

    expect(knownLocations).toContain('Blue Note Club');
    expect(knownLocations).toContain('Village Vanguard');
    expect(knownLocations.filter((l) => l === 'Blue Note Club').length).toBe(1);
  });

  it('performs batch metadata updates across multiple clips', () => {
    const clips = engine.getVirtualClips();
    expect(clips.length).toBeGreaterThanOrEqual(3);
    const targetIds = [clips[0].id, clips[1].id];

    const updatedList = engine.batchUpdateMetadata(targetIds, {
      artist: 'The Roots',
      location: 'Philadelphia Jam Session',
      category: 'concerts',
      addTags: ['LiveFestival', 'DirectTake'],
    });

    expect(updatedList.length).toBe(2);
    for (const item of updatedList) {
      expect(item.artist).toBe('The Roots');
      expect(item.location).toBe('Philadelphia Jam Session');
      expect(item.category).toBe('concerts');
      expect(item.userTags).toContain('LiveFestival');
      expect(item.userTags).toContain('DirectTake');
    }

    // Unselected clip remains untouched
    const untouched = engine.getVirtualClip(clips[2].id)!;
    expect(untouched.artist).not.toBe('The Roots');
  });

  it('tags audio files losslessly using TaggerService without corrupting files', async () => {
    const tagger = new TaggerService();

    // Create a valid test WAV file
    const testWavPath = path.join(tempDir, 'tagger_sample.wav');
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + 1000, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(44100, 24);
    header.writeUInt32LE(88200, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(1000, 40);
    const pcmData = Buffer.alloc(1000);
    fs.writeFileSync(testWavPath, Buffer.concat([header, pcmData]));

    const originalSize = fs.statSync(testWavPath).size;
    expect(originalSize).toBe(1044);

    const success = await tagger.tagAudioFile(testWavPath, {
      title: 'Acoustic Sketch 1',
      artist: 'Pat Metheny',
      location: 'Electric Lady Studios',
    });

    expect(success).toBe(true);
    expect(fs.existsSync(testWavPath)).toBe(true);
    // File size will include added RIFF metadata headers
    const newSize = fs.statSync(testWavPath).size;
    expect(newSize).toBeGreaterThanOrEqual(originalSize);

    // Non-fatal on nonexistent file
    const failNonexistent = await tagger.tagAudioFile('/nonexistent/file.wav', { title: 'Test' });
    expect(failNonexistent).toBe(false);
  });
});
