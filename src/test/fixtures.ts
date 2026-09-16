import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PrimaryCategory, RawAudioFile, VirtualClip, VaultSettings, DeletedFileRecord } from '../shared/types';
import { generateSyntheticWavBuffer } from './audio-fixture';

export interface FixtureOptions {
  writeAudioFiles?: boolean; // if false, generates metadata and registry without large audio files for high speed
  writeTranscriptSidecars?: boolean;
}

export const FIXTURE_COLLECTIONS = [
  'Research interviews',
  'Album sessions',
  'Personal ideas',
  'Weekly Standups',
];

export const FIXTURE_TOPICS = [
  'Product interview with design team',
  'Rehearsal notes & bridge harmonies',
  'Morning ideas on audio architecture',
  'Park soundscape & ambience recording',
  'Sprint planning discussion',
  'Guitar practice: fingerpicking groove',
  'User onboarding research interview',
  'Weekly retrospective and next steps',
];

export const FIXTURE_SOURCES = ['Zoom H1', 'Zoom H5', 'Files', 'In-app recorder', 'SD Card Pro'];

export interface GeneratedFixtureVault {
  vaultDir: string;
  rawFiles: RawAudioFile[];
  virtualClips: VirtualClip[];
  deletedFiles: DeletedFileRecord[];
  collections: string[];
}

/**
 * Generates a deterministic fixture vault at the target directory with exact counts and edge cases.
 */
export function generateFixtureVault(
  targetDir: string,
  count: 0 | 20 | 500 | 5000,
  options: FixtureOptions = {}
): GeneratedFixtureVault {
  const writeAudio = options.writeAudioFiles ?? (count <= 20);
  const writeSidecars = options.writeTranscriptSidecars ?? true;

  const rawDir = path.join(targetDir, 'raw');
  const exportsDir = path.join(targetDir, 'exports');
  const registryFile = path.join(targetDir, 'registry.json');

  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(exportsDir, { recursive: true });

  const rawFiles: RawAudioFile[] = [];
  const virtualClips: VirtualClip[] = [];
  const deletedFiles: DeletedFileRecord[] = [];

  if (count === 0) {
    const emptyRegistry = {
      version: 2,
      rawFiles: [],
      virtualClips: [],
      deletedFiles: [],
      settings: {
        vaultDirectory: targetDir,
        autoUnmountAfterIngest: true,
        useLocalModelsDefault: true,
        enableCloudFallback: false,
        whisperLanguage: 'en',
        rememberDeleteChoice: false,
      },
    };
    fs.writeFileSync(registryFile, JSON.stringify(emptyRegistry, null, 2), 'utf-8');
    return {
      vaultDir: targetDir,
      rawFiles: [],
      virtualClips: [],
      deletedFiles: [],
      collections: FIXTURE_COLLECTIONS,
    };
  }

  // Pre-generate a standard tiny WAV buffer for files if writeAudio is enabled
  const sampleWav = writeAudio ? generateSyntheticWavBuffer({ durationSeconds: 0.5, frequency: 440 }) : null;

  for (let i = 0; i < count; i++) {
    const rawId = `raw_${String(i + 1).padStart(5, '0')}`;
    const clipId = `clip_${String(i + 1).padStart(5, '0')}`;
    const topic = FIXTURE_TOPICS[i % FIXTURE_TOPICS.length];
    const source = FIXTURE_SOURCES[i % FIXTURE_SOURCES.length];
    const collection = FIXTURE_COLLECTIONS[i % FIXTURE_COLLECTIONS.length];

    // Edge case 1: Unknown recorded dates (every 11th item)
    const hasRecordedDate = i % 11 !== 0;
    const daysAgo = Math.floor(i / 4);
    const recordedDate = hasRecordedDate
      ? new Date(Date.UTC(2026, 8, 15 - daysAgo, 10, (i * 7) % 60, (i * 13) % 60)).toISOString()
      : undefined;

    // Imported date: recent for first 25 items, spread across months for others
    const importedDaysAgo = i < 25 ? Math.floor(i / 5) : Math.floor(i / 3) + 7;
    const importedAt = new Date(Date.UTC(2026, 8, 15 - importedDaysAgo, 14, 0, 0)).toISOString();

    // Edge case 2: Long titles and Unicode
    let title = `${topic}${i < 8 ? '' : ` · Session ${Math.floor(i / 8) + 1}`}`;
    if (i % 23 === 0) {
      title = `Café Réflexions & Audio Notes 🎙️ — ${title} (Take #${i + 1})`;
    } else if (i % 29 === 0) {
      title = `東京会議 · Tokyo Architecture Review 🚀: In-depth technical retrospective covering streaming, ingestion, and pipeline latency`;
    } else if (i % 37 === 0) {
      title = `Special Characters [Test] (Parentheses) "Quotes" & Slashes / Backslashes \\ Emoji ✨ #42`;
    }

    // Edge case 3: Same name from different sources
    const filename = i % 15 === 0 ? `ZOOM0001.WAV` : `AV_TAKE_${String(i + 1).padStart(5, '0')}.WAV`;
    const storagePath = path.join(rawDir, `${i + 1}_${filename}`);
    const fingerprint = crypto.createHash('sha256').update(`fixture_content_${i}_${filename}`).digest('hex');

    if (writeAudio && sampleWav) {
      fs.writeFileSync(storagePath, sampleWav);
    }

    const durationSeconds = 120 + ((i * 137) % 2400); // 2 mins to 42 mins

    // Edge case 4: Transcript states
    let state: 'Transcript ready' | 'Not transcribed' | 'No speech' | 'Failed' = 'Transcript ready';
    if (i % 31 === 0) state = 'Failed';
    else if (i % 19 === 0) state = 'Not transcribed';
    else if (i % 17 === 0) state = 'No speech';

    let transcription: string | undefined = undefined;
    let fullTranscription: string | undefined = undefined;
    let transcriptPath: string | undefined = undefined;
    let chunks: Array<{ text: string; timestamp: [number, number] }> | undefined = undefined;

    if (state === 'Transcript ready') {
      const sampleText =
        i % 4 === 0
          ? 'The onboarding experience should help people find the next step quickly. We can test it with three new users tomorrow.'
          : i % 4 === 1
          ? 'Let us try the chorus again, then save the strongest take for the album cut.'
          : i % 4 === 2
          ? 'Discussion on architectural redesign, persistent job history, and separated workspaces for imports and library.'
          : 'Leaves moving in a gentle breeze, distant footsteps and morning birds.';

      transcription = sampleText;
      fullTranscription = sampleText;

      chunks = [
        { text: 'The session started on time.', timestamp: [0, 4.5] },
        { text: sampleText, timestamp: [84.0, 96.5] }, // 01:24 timestamp hit
        { text: 'Wrapping up the decision points and next milestones.', timestamp: [136.0, 145.2] },
      ];

      if (writeSidecars) {
        transcriptPath = storagePath.replace(/\.[^/.]+$/, '') + '.txt';
        const chunksPath = storagePath.replace(/\.[^/.]+$/, '') + '.chunks.json';
        fs.writeFileSync(transcriptPath, sampleText, 'utf-8');
        fs.writeFileSync(chunksPath, JSON.stringify(chunks, null, 2), 'utf-8');
      }
    }

    const rawFile: RawAudioFile = {
      id: rawId,
      fingerprint,
      originalFilename: filename,
      storagePath,
      durationSeconds,
      sampleRate: 44100,
      channels: i % 2 === 0 ? 2 : 1,
      fileSizeBytes: 44 + durationSeconds * 44100 * 2,
      sourceDevice: source,
      importedAt,
      waveformPeaks: Array.from({ length: 60 }, (_, idx) => 0.2 + ((idx * 7 + i) % 60) / 100),
    };
    rawFiles.push(rawFile);

    const categories: PrimaryCategory[] = ['music', 'concerts', 'dictaphone', 'meeting', 'ambient', 'unclassified'];
    const category = categories[i % categories.length];

    const clip: VirtualClip = {
      id: clipId,
      parentFileId: rawId,
      title,
      startTimeSeconds: 0,
      endTimeSeconds: durationSeconds,
      category,
      userTags: [collection, source, category],
      classificationConfidence: 0.92,
      classificationSource: 'yamnet_local',
      transcription,
      fullTranscription,
      transcriptPath,
      transcriptionChunks: chunks,
      notes: i % 7 === 0 ? `Important note for take #${i + 1}` : undefined,
      isExcluded: false,
      createdAt: recordedDate || importedAt,
      updatedAt: importedAt,
    };
    virtualClips.push(clip);

    // Edge case 5: Child excerpts / clips under parent recording (for every 8th item)
    if (i % 8 === 0 && durationSeconds > 180) {
      const excerpt1: VirtualClip = {
        id: `clip_${String(i + 1).padStart(5, '0')}_excerpt_1`,
        parentFileId: rawId,
        title: `Excerpt: Key Decision from ${title.slice(0, 30)}`,
        startTimeSeconds: 84.0,
        endTimeSeconds: 145.0,
        category,
        userTags: [collection, 'Excerpt'],
        classificationConfidence: 0.95,
        classificationSource: 'user_manual',
        transcription: 'Key decision excerpt: onboarding and architecture.',
        fullTranscription: 'Key decision excerpt: onboarding and architecture.',
        isExcluded: false,
        createdAt: recordedDate || importedAt,
        updatedAt: importedAt,
      };
      virtualClips.push(excerpt1);
    }

    // Edge case 6: Deleted files / tombstones (for every 25th item)
    if (i % 25 === 0) {
      deletedFiles.push({
        id: `del_${i + 1}`,
        fingerprint: crypto.createHash('sha256').update(`deleted_${i}`).digest('hex'),
        originalFilename: `DELETED_TAKE_${i + 1}.WAV`,
        fileSizeBytes: 1024 * 1024 * 5,
        deletedAt: new Date(Date.UTC(2026, 8, 10)).toISOString(),
        title: `Deleted Recording #${i + 1}`,
        reason: 'User deleted from library',
      });
    }
  }

  const registry = {
    version: 2,
    rawFiles,
    virtualClips,
    deletedFiles,
    settings: {
      vaultDirectory: targetDir,
      autoUnmountAfterIngest: true,
      useLocalModelsDefault: true,
      enableCloudFallback: false,
      whisperLanguage: 'en',
      rememberDeleteChoice: false,
    },
  };

  fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2), 'utf-8');

  return {
    vaultDir: targetDir,
    rawFiles,
    virtualClips,
    deletedFiles,
    collections: FIXTURE_COLLECTIONS,
  };
}
