import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { generateSyntheticWavBuffer } from '../../test/audio-fixture';
import { DedupEngine } from '../../main/dedup-engine';
import { AudioEngine } from '../../main/audio-engine';
import { TitleService } from '../../main/title-service';
import { VirtualClip } from '../types';

describe('Deduplication & Classification Engine Tests', () => {
  let tempDir: string;
  let dedupEngine: DedupEngine;
  let audioEngine: AudioEngine;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiovault-test-'));
    dedupEngine = new DedupEngine(tempDir);
    audioEngine = new AudioEngine();
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('generates consistent fingerprints for identical audio files', () => {
    const wavBuffer = generateSyntheticWavBuffer({ durationSeconds: 1.0, frequency: 440 });
    const fileA = path.join(tempDir, 'take1.wav');
    const fileB = path.join(tempDir, 'take1_copy.wav');

    fs.writeFileSync(fileA, wavBuffer);
    fs.writeFileSync(fileB, wavBuffer);

    // Set same mtime for exact duplicate test
    const now = new Date();
    fs.utimesSync(fileA, now, now);
    fs.utimesSync(fileB, now, now);

    const hashA = dedupEngine.computeFileFingerprint(fileA);
    const hashB = dedupEngine.computeFileFingerprint(fileB);

    expect(hashA).toBe(hashB);
  });

  it('detects different fingerprints when content is modified', () => {
    const wavBuffer1 = generateSyntheticWavBuffer({ durationSeconds: 1.0, frequency: 440 });
    const wavBuffer2 = generateSyntheticWavBuffer({ durationSeconds: 2.0, frequency: 880 });

    const file1 = path.join(tempDir, 'file1.wav');
    const file2 = path.join(tempDir, 'file2.wav');

    fs.writeFileSync(file1, wavBuffer1);
    fs.writeFileSync(file2, wavBuffer2);

    const hash1 = dedupEngine.computeFileFingerprint(file1);
    const hash2 = dedupEngine.computeFileFingerprint(file2);

    expect(hash1).not.toBe(hash2);
  });

  it('analyzes WAV metrics and extracts normalized waveform peaks', () => {
    const wavBuffer = generateSyntheticWavBuffer({ durationSeconds: 2.0, sampleRate: 44100 });
    const filePath = path.join(tempDir, 'metric_test.wav');
    fs.writeFileSync(filePath, wavBuffer);

    const result = audioEngine.analyzeWavFile(filePath, 50);
    expect(result.features.durationSeconds).toBeCloseTo(2.0, 1);
    expect(result.features.sampleRate).toBe(44100);
    expect(result.peaks.length).toBe(50);
    expect(result.peaks[0]).toBeGreaterThan(0);
  });

  it('classifies pulsed speech audio as dictaphone or meeting', () => {
    const speechWav = generateSyntheticWavBuffer({ durationSeconds: 5.0, isPulsedSpeech: true });
    const filePath = path.join(tempDir, 'speech.wav');
    fs.writeFileSync(filePath, speechWav);

    const result = audioEngine.analyzeWavFile(filePath);
    const classification = audioEngine.classifyAcoustics(result.features, 'ZOOM_MEMO_01.WAV');

    expect(classification.category).toBe('dictaphone');
    expect(classification.confidence).toBeGreaterThan(0.7);
  });

  it('classifies continuous harmonic tone as music', () => {
    const musicWav = generateSyntheticWavBuffer({ durationSeconds: 10.0, frequency: 440 });
    const filePath = path.join(tempDir, 'singing_take.wav');
    fs.writeFileSync(filePath, musicWav);

    const result = audioEngine.analyzeWavFile(filePath);
    const classification = audioEngine.classifyAcoustics(result.features, 'VOCAL_REHEARSAL.WAV');

    expect(classification.category).toBe('music');
    expect(classification.confidence).toBeGreaterThan(0.7);
  });

  it('correctly parses BWF Broadcast Wave format with bext chunk before fmt and 32-bit float', () => {
    // Generate a BWF file: RIFF header -> bext chunk -> fmt chunk (32-bit float) -> data chunk
    const bextData = Buffer.alloc(256, 'bext metadata');
    const bextChunk = Buffer.alloc(8 + 256);
    bextChunk.write('bext', 0);
    bextChunk.writeUInt32LE(256, 4);
    bextData.copy(bextChunk, 8);

    // fmt chunk: IEEE Float (format 3), 2 channels, 48000 Hz, 32 bits
    const fmtChunk = Buffer.alloc(8 + 16);
    fmtChunk.write('fmt ', 0);
    fmtChunk.writeUInt32LE(16, 4);
    fmtChunk.writeUInt16LE(3, 8); // format 3 = IEEE float
    fmtChunk.writeUInt16LE(2, 10); // 2 channels
    fmtChunk.writeUInt32LE(48000, 12); // 48kHz
    fmtChunk.writeUInt32LE(48000 * 2 * 4, 16); // byte rate
    fmtChunk.writeUInt16LE(8, 20); // block align
    fmtChunk.writeUInt16LE(32, 22); // 32 bits per sample

    // data chunk: 48000 samples * 2 channels * 4 bytes = 384000 bytes (1 second)
    const numSamples = 48000;
    const dataSize = numSamples * 2 * 4;
    const dataChunk = Buffer.alloc(8 + dataSize);
    dataChunk.write('data', 0);
    dataChunk.writeUInt32LE(dataSize, 4);
    for (let i = 0; i < numSamples; i++) {
      const floatVal = Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.5;
      dataChunk.writeFloatLE(floatVal, 8 + i * 8); // left
      dataChunk.writeFloatLE(floatVal, 8 + i * 8 + 4); // right
    }

    const totalRiffSize = 4 + bextChunk.length + fmtChunk.length + dataChunk.length;
    const riffHeader = Buffer.alloc(12);
    riffHeader.write('RIFF', 0);
    riffHeader.writeUInt32LE(totalRiffSize, 4);
    riffHeader.write('WAVE', 8);

    const bwfFile = Buffer.concat([riffHeader, bextChunk, fmtChunk, dataChunk]);
    const filePath = path.join(tempDir, 'bwf_32float.wav');
    fs.writeFileSync(filePath, bwfFile);

    const result = audioEngine.analyzeWavFile(filePath, 50);
    expect(result.features.durationSeconds).toBeCloseTo(1.0, 1);
    expect(result.features.sampleRate).toBe(48000);
    expect(result.features.channels).toBe(2);
    expect(result.peaks.length).toBe(50);
    expect(result.peaks[10]).toBeGreaterThan(0.2);
  });

  it('extracts creation timestamp from BWF bext chunk and Zoom filename patterns', () => {
    // 1. Zoom filename pattern (YYMMDD-HHMMSS)
    const zoomPath = path.join(tempDir, '260831-185613.WAV');
    fs.writeFileSync(zoomPath, 'dummy');
    const zoomTs = audioEngine.extractCreationTimestamp(zoomPath);
    expect(zoomTs).toBe('2026-08-31T18:56:13.000Z');

    // 2. Prefixed Zoom filename pattern (e.g. 1788833968188_260730-080728.WAV)
    const prefixedPath = path.join(tempDir, '1788833968188_260730-080728.WAV');
    fs.writeFileSync(prefixedPath, 'dummy');
    const prefixedTs = audioEngine.extractCreationTimestamp(prefixedPath);
    expect(prefixedTs).toBe('2026-07-30T08:07:28.000Z');

    // 3. BWF bext chunk (OriginationDate + OriginationTime)
    const bextBuf = Buffer.alloc(65536);
    bextBuf.write('RIFF', 0);
    bextBuf.writeUInt32LE(65536 - 8, 4);
    bextBuf.write('WAVE', 8);
    bextBuf.write('bext', 12);
    bextBuf.writeUInt32LE(600, 16);
    // bext data starts at 20
    bextBuf.write('2026-09-07', 20 + 320, 'ascii');
    bextBuf.write('10:17:14', 20 + 330, 'ascii');

    const bwfPath = path.join(tempDir, 'take_bwf.wav');
    fs.writeFileSync(bwfPath, bextBuf);
    const bwfTs = audioEngine.extractCreationTimestamp(bwfPath, bextBuf);
    expect(bwfTs).toBe('2026-09-07T10:17:14.000Z');
  });

  it('generates concise titles from transcripts and preserves root file names', async () => {
    const titleService = new TitleService();

    // 1. Cleaning transcript
    const raw = '[Whisper]: "So it is a pushing feel. I am blowing it out. ...short take detected..."';
    const cleaned = titleService.cleanTranscript(raw);
    expect(cleaned).not.toContain('[Whisper]');
    expect(cleaned).not.toContain('short take detected');
    expect(cleaned).toContain('pushing feel');

    // 2. Base filename extraction
    expect(titleService.extractBaseFileName('260831-185613.WAV')).toBe('260831-185613');
    expect(titleService.extractBaseFileName('260831-185613 - Old Title.wav')).toBe('260831-185613');
    expect(titleService.extractBaseFileName('/raw/1788833968188_260730-080728.WAV')).toBe('1788833968188_260730-080728');

    // 3. Generating title from speech
    const speech = 'Discussing the mobile iOS application version for the field recorder.';
    const shortTitle = await titleService.generateShortTitle(speech);
    expect(shortTitle.length).toBeGreaterThan(0);
    const words = shortTitle.split(' ');
    expect(words.length).toBeLessThanOrEqual(5);

    // 4. Composite title formatting
    const composite = await titleService.generateCompositeTitle('260907-180558', speech);
    expect(composite.startsWith('260907-180558 - ')).toBe(true);
    expect(composite.length).toBeGreaterThan('260907-180558 - '.length);
  });

  it('manages export directory and stores exported MP3 metadata on virtual clips', () => {
    const exportsDir = dedupEngine.getExportsDir();
    expect(exportsDir).toBe(path.join(tempDir, 'exports'));
    expect(fs.existsSync(exportsDir)).toBe(true);

    const clipId = 'test-mp3-clip-1';
    dedupEngine.addVirtualClip({
      id: clipId,
      parentFileId: 'raw-1',
      title: '260831-185613 - Pushing Feel',
      startTimeSeconds: 0,
      endTimeSeconds: 45.5,
      category: 'music',
      userTags: ['Guitar', 'Idea'],
      classificationConfidence: 0.95,
      classificationSource: 'whisper_local',
      transcription: 'Testing MP3 metadata export',
      notes: 'Take 3 with overdrive',
      isExcluded: false,
      createdAt: '2026-08-31T18:56:13.000Z',
      updatedAt: '2026-08-31T18:56:13.000Z',
    });

    const exportPath = path.join(exportsDir, '260831-185613 - Pushing Feel.mp3');
    const exportedAt = new Date().toISOString();

    const updated = dedupEngine.updateVirtualClip(clipId, {
      exportedMp3Path: exportPath,
      exportedAt,
    });

    expect(updated).toBeDefined();
    expect(updated?.exportedMp3Path).toBe(exportPath);
    expect(updated?.exportedAt).toBe(exportedAt);

    // Verify persisted in registry
    const reloaded = dedupEngine.getVirtualClips().find((c) => c.id === clipId);
    expect(reloaded?.exportedMp3Path).toBe(exportPath);
    expect(reloaded?.exportedAt).toBe(exportedAt);
  });

  it('supports in-app recorded takes with custom titles and source tracking', () => {
    const rawDir = dedupEngine.getRawDir();
    const takeWav = generateSyntheticWavBuffer({ durationSeconds: 2.5, isPulsedSpeech: true });
    const takePath = path.join(rawDir, 'recording_test_take.wav');
    fs.writeFileSync(takePath, takeWav);

    const fingerprint = dedupEngine.computeFileFingerprint(takePath);
    const analysis = audioEngine.analyzeWavFile(takePath);
    const rawFileId = 'raw_rec_test_1';

    dedupEngine.addRawFile({
      id: rawFileId,
      fingerprint,
      originalFilename: 'recording_test_take.wav',
      storagePath: takePath,
      durationSeconds: analysis.features.durationSeconds,
      sampleRate: analysis.features.sampleRate,
      channels: analysis.features.channels,
      fileSizeBytes: takeWav.length,
      sourceDevice: 'In-App Recorder',
      importedAt: new Date().toISOString(),
      waveformPeaks: analysis.peaks,
    });

    const clipId = 'clip_rec_test_1';
    const newClip: VirtualClip = {
      id: clipId,
      parentFileId: rawFileId,
      title: 'In-App Take · 07:52',
      startTimeSeconds: 0,
      endTimeSeconds: 2.5,
      category: 'dictaphone',
      userTags: ['In-App Take', 'Voice Memo'],
      classificationConfidence: 0.95,
      classificationSource: 'yamnet_local',
      transcription: 'Testing mic capture in app',
      isExcluded: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    dedupEngine.addVirtualClip(newClip);

    const retrievedClip = dedupEngine.getVirtualClips().find((c) => c.id === clipId);
    expect(retrievedClip).toBeDefined();
    expect(retrievedClip?.id).toBe(clipId);
    expect(retrievedClip?.userTags).toContain('In-App Take');

    // Test search filtering query across title and transcription
    const allClips = dedupEngine.getVirtualClips();
    const query = 'mic capture';
    const matches = allClips.filter((c) =>
      c.title.toLowerCase().includes(query) || (c.transcription || '').toLowerCase().includes(query)
    );
    expect(matches.length).toBe(1);
    expect(matches[0].id).toBe(clipId);
  });
});

