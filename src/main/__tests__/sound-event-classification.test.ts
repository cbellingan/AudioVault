import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  normalizeSoundLabel,
  synthesizeAcousticTranscription,
  weaveSoundEventsIntoTranscript,
} from '../sound-event-formatter';
import { AudioEngine } from '../audio-engine';
import { DedupEngine } from '../dedup-engine';
import { PipelineOrchestrator } from '../pipeline-orchestrator';
import { SoundEvent, RawAudioFile, VirtualClip } from '../../shared/types';
import { generateSyntheticWavBuffer } from '../../test/audio-fixture';

describe('Sound Event Classification & Acoustic Transcriptions', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiovault-sound-event-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('Sound Event Label Normalization & Icons', () => {
    it('normalizes bird vocalizations to natural phrase and emoji', () => {
      const norm = normalizeSoundLabel('Bird vocalization, bird call, birds chirping');
      expect(norm.cleanLabel).toBe('Birds chirping');
      expect(norm.icon).toBe('🐦');
      expect(norm.category).toBe('nature');
      expect(norm.isProminentCue).toBe(true);
    });

    it('normalizes horse neighs and whinnies to natural phrase and emoji', () => {
      const norm = normalizeSoundLabel('Horse, Neigh, whinny');
      expect(norm.cleanLabel).toBe('Horse neigh');
      expect(norm.icon).toBe('🐴');
      expect(norm.category).toBe('animal');
      expect(norm.isProminentCue).toBe(true);
    });

    it('normalizes owl calls', () => {
      const norm = normalizeSoundLabel('Owl');
      expect(norm.cleanLabel).toBe('Owl call');
      expect(norm.icon).toBe('🦉');
      expect(norm.category).toBe('animal');
    });

    it('normalizes musical instruments and applause', () => {
      const guitar = normalizeSoundLabel('Acoustic guitar');
      expect(guitar.cleanLabel).toBe('Acoustic guitar');
      expect(guitar.icon).toBe('🎸');

      const applause = normalizeSoundLabel('Applause, clapping');
      expect(applause.cleanLabel).toBe('Applause / Clapping');
      expect(applause.icon).toBe('👏');
      expect(applause.isProminentCue).toBe(true);
    });
  });

  describe('Acoustic Transcript Synthesis', () => {
    it('synthesizes structured timestamped passages and summary line from sound events', () => {
      const events: SoundEvent[] = [
        { label: 'Birds chirping', confidence: 0.88, timestamp: [0, 10], icon: '🐦' },
        { label: 'Owl call', confidence: 0.66, timestamp: [10, 20], icon: '🦉' },
        { label: 'Nature / Outdoor ambiance', confidence: 0.75, timestamp: [20, 30], icon: '🌲' },
      ];

      const synth = synthesizeAcousticTranscription(events);

      expect(synth.transcription).toContain('🎧 [Acoustic Scene]: Birds chirping, Owl call, Nature / Outdoor ambiance');
      expect(synth.fullTranscription).toContain('[00:00] 🐦 Birds chirping (88%)');
      expect(synth.fullTranscription).toContain('[00:10] 🦉 Owl call (66%)');
      expect(synth.fullTranscription).toContain('[00:20] 🌲 Nature / Outdoor ambiance (75%)');

      expect(synth.chunks).toHaveLength(3);
      expect(synth.chunks[0]).toEqual({
        text: '🐦 Birds chirping',
        timestamp: [0, 10],
      });
      expect(synth.chunks[1]).toEqual({
        text: '🦉 Owl call',
        timestamp: [10, 20],
      });
      expect(synth.tags).toContain('Birds chirping');
      expect(synth.tags).toContain('Owl call');
    });

    it('weaves prominent acoustic cues (like horse neigh) into speech transcripts chronologically', () => {
      const speechTranscript = 'Welcome to the ranch. Let us check the stables.';
      const speechChunks = [
        { text: 'Welcome to the ranch.', timestamp: [0, 2.5] as [number, number] },
        { text: 'Let us check the stables.', timestamp: [6.0, 9.0] as [number, number] },
      ];
      const soundEvents: SoundEvent[] = [
        { label: 'Horse neigh', confidence: 0.92, timestamp: [3.5, 5.5], icon: '🐴' },
      ];

      const woven = weaveSoundEventsIntoTranscript(speechTranscript, speechChunks, soundEvents);

      expect(woven.chunks).toHaveLength(3);
      expect(woven.chunks[0].text).toBe('Welcome to the ranch.');
      expect(woven.chunks[1].text).toBe('[Sound Event: 🐴 Horse neigh]');
      expect(woven.chunks[2].text).toBe('Let us check the stables.');
      expect(woven.fullTranscription).toContain('[00:03] [Sound Event: 🐴 Horse neigh]');
      expect(woven.tags).toContain('Horse neigh');
    });
  });

  describe('AudioEngine Integration', () => {
    it('generates acoustic transcriptions for ambient/bird takes when speech is absent', async () => {
      const audioEngine = new AudioEngine();
      const wavBuf = generateSyntheticWavBuffer({ durationSeconds: 5, sampleRate: 44100 });
      const testFilePath = path.join(tempDir, 'ambient_birds_nature.wav');
      fs.writeFileSync(testFilePath, wavBuf);

      const details = await audioEngine.transcribeAudioDetails(testFilePath, 5);

      expect(details).not.toBeNull();
      expect(details?.isAcousticOnly).toBe(true);
      expect(details?.text).toContain('Birds chirping');
      expect(details?.summary).toContain('🎧 [Acoustic Scene]');
      expect(details?.chunks && details.chunks.length > 0).toBe(true);
      expect(details?.soundEvents && details.soundEvents.length > 0).toBe(true);

      const features = audioEngine.analyzeWavFile(testFilePath).features;
      const classification = audioEngine.classifyAcoustics(features, 'ambient_birds_nature.wav', details?.text, details?.soundEvents);

      expect(classification.category).toBe('ambient');
      expect(classification.tags).toContain('Birds chirping');
    });

    it('generates acoustic transcriptions for horse recording takes', async () => {
      const audioEngine = new AudioEngine();
      const wavBuf = generateSyntheticWavBuffer({ durationSeconds: 5, sampleRate: 44100 });
      const testFilePath = path.join(tempDir, 'horse_track_take.wav');
      fs.writeFileSync(testFilePath, wavBuf);

      const details = await audioEngine.transcribeAudioDetails(testFilePath, 5);

      expect(details).not.toBeNull();
      expect(details?.text).toContain('Horse neigh');
      expect(details?.summary).toContain('Horse neigh');
      expect(details?.soundEvents?.[0].label).toBe('Horse neigh');
    });
  });

  describe('DedupEngine Auto-Healing & Backfill', () => {
    it('automatically heals legacy clips with [BLANK_AUDIO] by generating sound event transcriptions', async () => {
      const vaultDir = path.join(tempDir, 'vault');
      const rawDir = path.join(vaultDir, 'raw');
      fs.mkdirSync(rawDir, { recursive: true });

      const wavBuf = generateSyntheticWavBuffer({ durationSeconds: 5, sampleRate: 44100 });
      const wavPath = path.join(rawDir, '260927-065221_blank_audio.wav');
      fs.writeFileSync(wavPath, wavBuf);

      // Create legacy registry where fullTranscription was [ [ [BLANK_AUDIO] or blank
      const legacyRaw: RawAudioFile = {
        id: 'raw_01',
        fingerprint: 'fp_01',
        originalFilename: '260927-065221_blank_audio.wav',
        storagePath: wavPath,
        durationSeconds: 5,
        sampleRate: 44100,
        channels: 1,
        fileSizeBytes: wavBuf.length,
        sourceDevice: 'Zoom',
        importedAt: new Date().toISOString(),
        waveformPeaks: [0.1, 0.2],
      };

      const legacyClip: VirtualClip = {
        id: 'clip_01',
        parentFileId: 'raw_01',
        title: '260927-065221 - Blank_audio',
        startTimeSeconds: 0,
        endTimeSeconds: 5,
        category: 'ambient',
        userTags: ['Spoken Memo'],
        classificationConfidence: 0.8,
        classificationSource: 'yamnet_local',
        fullTranscription: '[ [ [BLANK_AUDIO]',
        transcriptState: 'no_speech',
        isExcluded: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const registryPath = path.join(vaultDir, 'registry.json');
      fs.writeFileSync(
        registryPath,
        JSON.stringify({
          version: 3,
          rawFiles: [legacyRaw],
          virtualClips: [legacyClip],
        }),
        'utf-8'
      );

      // Load DedupEngine - should auto-detect and heal the clip
      const dedup = new DedupEngine(vaultDir);
      const healedClip = dedup.getVirtualClip('clip_01');

      expect(healedClip).toBeDefined();
      expect(healedClip?.soundEvents && healedClip.soundEvents.length > 0).toBe(true);
      expect(healedClip?.fullTranscription).toContain('Birds chirping');
      expect(healedClip?.transcription).toContain('🎧 [Acoustic Scene]');
      expect(healedClip?.transcriptState).toBe('ready');
      expect(healedClip?.userTags).toContain('Birds chirping');

      // Check sidecar file
      const txtPath = path.join(rawDir, '260927-065221_blank_audio.txt');
      expect(fs.existsSync(txtPath)).toBe(true);
      const txtContent = fs.readFileSync(txtPath, 'utf-8');
      expect(txtContent).toContain('Birds chirping');
    });
  });

  describe('Pipeline Orchestrator End-to-End Ingestion', () => {
    it('ingests an ambient recording and stores sound event transcriptions and sidecars', async () => {
      const vaultDir = path.join(tempDir, 'vault');
      const dedup = new DedupEngine(vaultDir);
      const audioEngine = new AudioEngine();
      const orchestrator = new PipelineOrchestrator(dedup, undefined as any, audioEngine);

      const wavBuf = generateSyntheticWavBuffer({ durationSeconds: 6, sampleRate: 44100 });
      const sourceWav = path.join(tempDir, 'source_ambient_birds.wav');
      fs.writeFileSync(sourceWav, wavBuf);

      orchestrator.enqueueLocalFile(sourceWav, 'Source Birds Take');

      await new Promise<void>((resolve) => {
        orchestrator.on('pipeline-status', (status) => {
          if (status.completedJobs >= 1) {
            resolve();
          }
        });
        setTimeout(resolve, 2000);
      });

      const clips = dedup.getVirtualClips();
      const ambientClip = clips.find((c) => c.title.includes('Birds'));

      expect(ambientClip).toBeDefined();
      expect(ambientClip?.category).toBe('ambient');
      expect(ambientClip?.soundEvents && ambientClip.soundEvents.length > 0).toBe(true);
      expect(ambientClip?.transcription).toContain('🎧 [Acoustic Scene]');
      expect(ambientClip?.fullTranscription).toContain('Birds chirping');
      expect(ambientClip?.transcriptionChunks && ambientClip.transcriptionChunks.length > 0).toBe(true);
      expect(ambientClip?.transcriptState).toBe('ready');
      expect(ambientClip?.transcriptPath).toBeDefined();
      if (ambientClip?.transcriptPath) {
        expect(fs.existsSync(ambientClip.transcriptPath)).toBe(true);
      }
    });
  });
});
