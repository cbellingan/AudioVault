import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  formatSrtTimestamp,
  generateSrtContent,
  sanitizeFileName,
  executeBatchExport,
} from '../export-service';
import { DedupEngine } from '../dedup-engine';
import { RawAudioFile, VirtualClip } from '../../shared/types';

describe('Batch Export Service (Slice F11)', () => {
  let sandboxDir: string;
  let dedupEngine: DedupEngine;

  beforeEach(() => {
    process.env.AUDIOVAULT_TEST_MODE = '1';
    sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiovault-export-test-'));
    dedupEngine = new DedupEngine(sandboxDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch {}
  });

  describe('SRT Subtitle Formatting', () => {
    it('formats seconds to standard HH:MM:SS,mmm SubRip timestamp', () => {
      expect(formatSrtTimestamp(0)).toBe('00:00:00,000');
      expect(formatSrtTimestamp(5.25)).toBe('00:00:05,250');
      expect(formatSrtTimestamp(75.5)).toBe('00:01:15,500');
      expect(formatSrtTimestamp(3665.123)).toBe('01:01:05,123');
    });

    it('generates multi-segment SRT content from transcription chunks', () => {
      const chunks: Array<{ text: string; timestamp: [number, number] }> = [
        { text: 'First segment of speech.', timestamp: [0, 2.5] },
        { text: 'Second segment continues.', timestamp: [2.5, 6.12] },
      ];
      const srt = generateSrtContent('Full transcript', chunks, 10);
      expect(srt).toContain('1\n00:00:00,000 --> 00:00:02,500\nFirst segment of speech.');
      expect(srt).toContain('2\n00:00:02,500 --> 00:00:06,120\nSecond segment continues.');
    });

    it('generates single fallback block when only plain transcript is available', () => {
      const srt = generateSrtContent('Quick voice memo idea.', undefined, 4.5);
      expect(srt).toBe('1\n00:00:00,000 --> 00:00:04,500\nQuick voice memo idea.\n');
    });

    it('returns empty string when transcript is empty', () => {
      expect(generateSrtContent('')).toBe('');
      expect(generateSrtContent('   ')).toBe('');
    });
  });

  describe('Filename Sanitization', () => {
    it('sanitizes illegal path characters and cleans spaces', () => {
      expect(sanitizeFileName('Idea / Draft: Part 1? *Cool*')).toBe('Idea _ Draft_ Part 1_ _Cool_');
      expect(sanitizeFileName('   Chorus <Take 2> | Final  ')).toBe('Chorus _Take 2_ _ Final');
      expect(sanitizeFileName('')).toBe('Untitled');
    });
  });

  describe('executeBatchExport', () => {
    it('exports lossless WAV and SRT subtitles, handling filename collisions gracefully', async () => {
      const exportsDir = path.join(sandboxDir, 'custom_exports');
      fs.mkdirSync(exportsDir, { recursive: true });

      // Create a dummy WAV file
      const rawDir = path.join(sandboxDir, 'raw');
      fs.mkdirSync(rawDir, { recursive: true });
      const rawPath1 = path.join(rawDir, 'test_take_1.wav');
      fs.writeFileSync(rawPath1, Buffer.from('RIFF....WAVEfmt ....data....test_audio_payload_1'));

      const rawRecord: RawAudioFile = {
        id: 'raw_01',
        fingerprint: 'fp_raw_01',
        originalFilename: 'test_take_1.wav',
        storagePath: rawPath1,
        durationSeconds: 10,
        sampleRate: 44100,
        channels: 1,
        fileSizeBytes: 100,
        sourceDevice: 'Microphone',
        importedAt: new Date().toISOString(),
        waveformPeaks: [],
      };
      dedupEngine.addRawFile(rawRecord);

      // Clip 1
      const clip1: VirtualClip = {
        id: 'clip_01',
        parentFileId: 'raw_01',
        title: 'Song Idea',
        startTimeSeconds: 0,
        endTimeSeconds: 10,
        category: 'music',
        userTags: ['Demo'],
        classificationConfidence: 0.9,
        classificationSource: 'yamnet_local',
        fullTranscription: 'This is the first take of the chorus.',
        transcriptionChunks: [
          { text: 'This is the first take', timestamp: [0, 4] },
          { text: 'of the chorus.', timestamp: [4, 8] },
        ],
        isExcluded: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      dedupEngine.addVirtualClip(clip1);

      // Create raw 2 and Clip 2 with the same title to test collision avoidance
      const rawPath2 = path.join(rawDir, 'test_take_2.wav');
      fs.writeFileSync(rawPath2, Buffer.from('RIFF....WAVEfmt ....data....test_audio_payload_2'));
      const rawRecord2: RawAudioFile = {
        id: 'raw_02',
        fingerprint: 'fp_raw_02',
        originalFilename: 'test_take_2.wav',
        storagePath: rawPath2,
        durationSeconds: 10,
        sampleRate: 44100,
        channels: 1,
        fileSizeBytes: 100,
        sourceDevice: 'Microphone',
        importedAt: new Date().toISOString(),
        waveformPeaks: [],
      };
      dedupEngine.addRawFile(rawRecord2);

      const clip2: VirtualClip = {
        id: 'clip_02',
        parentFileId: 'raw_02',
        title: 'Song Idea',
        startTimeSeconds: 0,
        endTimeSeconds: 10,
        category: 'music',
        userTags: ['Demo'],
        classificationConfidence: 0.9,
        classificationSource: 'yamnet_local',
        editedTranscript: 'User revised transcript for take two.',
        isExcluded: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      dedupEngine.addVirtualClip(clip2);

      const result = await executeBatchExport(
        {
          clipIds: ['clip_01', 'clip_02'],
          destinationDir: exportsDir,
          audioFormat: 'wav',
          transcriptFormat: 'srt',
        },
        dedupEngine
      );

      expect(result.totalRequested).toBe(2);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(0);

      // Check first clip exported files
      const wav1 = path.join(exportsDir, 'Song Idea.wav');
      const srt1 = path.join(exportsDir, 'Song Idea.srt');
      expect(fs.existsSync(wav1)).toBe(true);
      expect(fs.existsSync(srt1)).toBe(true);

      const srt1Content = fs.readFileSync(srt1, 'utf-8');
      expect(srt1Content).toContain('00:00:00,000 --> 00:00:04,000');
      expect(srt1Content).toContain('This is the first take');

      // Check second clip collision avoidance
      const wav2 = path.join(exportsDir, 'Song Idea_2.wav');
      const srt2 = path.join(exportsDir, 'Song Idea_2.srt');
      expect(fs.existsSync(wav2)).toBe(true);
      expect(fs.existsSync(srt2)).toBe(true);

      const srt2Content = fs.readFileSync(srt2, 'utf-8');
      expect(srt2Content).toContain('User revised transcript for take two.');
    });

    it('exports plain text transcripts when transcriptFormat is txt and audioFormat is none', async () => {
      const exportsDir = path.join(sandboxDir, 'text_exports');
      fs.mkdirSync(exportsDir, { recursive: true });

      const rawDir = path.join(sandboxDir, 'raw');
      fs.mkdirSync(rawDir, { recursive: true });
      const rawPath = path.join(rawDir, 'memo.wav');
      fs.writeFileSync(rawPath, Buffer.from('RIFFdummy'));

      const rawRecord: RawAudioFile = {
        id: 'raw_memo',
        fingerprint: 'fp_memo',
        originalFilename: 'memo.wav',
        storagePath: rawPath,
        durationSeconds: 5,
        sampleRate: 44100,
        channels: 1,
        fileSizeBytes: 50,
        sourceDevice: 'Recorder',
        importedAt: new Date().toISOString(),
        waveformPeaks: [],
      };
      dedupEngine.addRawFile(rawRecord);

      const clip: VirtualClip = {
        id: 'clip_memo',
        parentFileId: 'raw_memo',
        title: 'Meeting Notes',
        startTimeSeconds: 0,
        endTimeSeconds: 5,
        category: 'dictaphone',
        userTags: ['Work'],
        classificationConfidence: 0.95,
        classificationSource: 'yamnet_local',
        fullTranscription: 'Action items: ship Slice F11 by end of day.',
        isExcluded: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      dedupEngine.addVirtualClip(clip);

      const result = await executeBatchExport(
        {
          clipIds: ['clip_memo'],
          destinationDir: exportsDir,
          audioFormat: 'none',
          transcriptFormat: 'txt',
        },
        dedupEngine
      );

      expect(result.succeeded).toBe(1);
      const txtPath = path.join(exportsDir, 'Meeting Notes.txt');
      expect(fs.existsSync(txtPath)).toBe(true);
      expect(fs.readFileSync(txtPath, 'utf-8')).toBe('Action items: ship Slice F11 by end of day.');
      expect(fs.existsSync(path.join(exportsDir, 'Meeting Notes.wav'))).toBe(false);
    });

    it('exports MP3 audio and updates clip metadata', async () => {
      const exportsDir = path.join(sandboxDir, 'mp3_exports');
      fs.mkdirSync(exportsDir, { recursive: true });

      const rawDir = path.join(sandboxDir, 'raw');
      fs.mkdirSync(rawDir, { recursive: true });
      const rawPath = path.join(rawDir, 'test_mp3.wav');
      fs.writeFileSync(rawPath, Buffer.from('RIFFdummywav'));

      dedupEngine.addRawFile({
        id: 'raw_mp3_parent',
        fingerprint: 'fp_mp3_parent',
        originalFilename: 'test_mp3.wav',
        storagePath: rawPath,
        durationSeconds: 12,
        sampleRate: 44100,
        channels: 1,
        fileSizeBytes: 200,
        sourceDevice: 'Microphone',
        importedAt: new Date().toISOString(),
        waveformPeaks: [],
      });

      const excerptClip: VirtualClip = {
        id: 'clip_excerpt_slice',
        parentFileId: 'raw_mp3_parent',
        title: 'Excerpt Hook',
        startTimeSeconds: 2,
        endTimeSeconds: 7,
        category: 'music',
        userTags: ['Hook', 'Excerpt'],
        classificationConfidence: 0.9,
        classificationSource: 'user_manual',
        isExcluded: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      dedupEngine.addVirtualClip(excerptClip);

      const result = await executeBatchExport(
        {
          clipIds: ['clip_excerpt_slice'],
          destinationDir: exportsDir,
          audioFormat: 'mp3',
          transcriptFormat: 'none',
        },
        dedupEngine
      );

      expect(result.succeeded).toBe(1);
      const mp3Path = path.join(exportsDir, 'Excerpt Hook.mp3');
      expect(fs.existsSync(mp3Path)).toBe(true);

      const updated = dedupEngine.getVirtualClip('clip_excerpt_slice');
      expect(updated?.exportedMp3Path).toBe(mp3Path);
      expect(updated?.exportedAt).toBeDefined();
    });
  });
});
