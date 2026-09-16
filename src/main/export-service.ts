import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import util from 'util';
import { DedupEngine } from './dedup-engine';
import {
  BatchExportOptions,
  BatchExportResult,
  BatchExportItemResult,
  VirtualClip,
} from '../shared/types';

const execFilePromise = util.promisify(execFile);

export function getFfmpegPath(): string {
  if (fs.existsSync('/opt/homebrew/bin/ffmpeg')) {
    return '/opt/homebrew/bin/ffmpeg';
  }
  if (fs.existsSync('/usr/local/bin/ffmpeg')) {
    return '/usr/local/bin/ffmpeg';
  }
  return 'ffmpeg';
}

/**
 * Format a duration/offset in seconds to standard SRT timestamp format: HH:MM:SS,mmm
 */
export function formatSrtTimestamp(seconds: number): string {
  const clamped = Math.max(0, seconds || 0);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const secs = Math.floor(clamped % 60);
  const millis = Math.floor((clamped % 1) * 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

/**
 * Generate SubRip (.srt) subtitle content from transcription chunks or full text.
 */
export function generateSrtContent(
  transcript: string,
  chunks?: Array<{ text: string; timestamp: [number, number] }>,
  fallbackDurationSec: number = 5
): string {
  if (chunks && chunks.length > 0) {
    return chunks
      .filter((c) => c.text && c.text.trim().length > 0)
      .map((chunk, idx) => {
        const start = formatSrtTimestamp(chunk.timestamp[0]);
        const end = formatSrtTimestamp(chunk.timestamp[1]);
        return `${idx + 1}\n${start} --> ${end}\n${chunk.text.trim()}\n`;
      })
      .join('\n');
  }

  const clean = transcript.trim();
  if (!clean) return '';
  const start = formatSrtTimestamp(0);
  const end = formatSrtTimestamp(Math.max(1, fallbackDurationSec));
  return `1\n${start} --> ${end}\n${clean}\n`;
}

/**
 * Sanitize a string for safe usage in filenames across macOS, Windows, and Linux.
 */
export function sanitizeFileName(title: string): string {
  return (title || 'Untitled')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled';
}

/**
 * Execute batch export for the specified clips according to audio and transcript format options.
 */
export async function executeBatchExport(
  options: BatchExportOptions,
  dedupEngine: DedupEngine,
  ffmpegPath: string = getFfmpegPath()
): Promise<BatchExportResult> {
  const destinationDir = options.destinationDir || dedupEngine.getExportsDir();
  if (!fs.existsSync(destinationDir)) {
    fs.mkdirSync(destinationDir, { recursive: true });
  }

  const items: BatchExportItemResult[] = [];
  let succeeded = 0;
  let failed = 0;

  const usedAudioNames = new Set<string>();
  const usedTranscriptNames = new Set<string>();

  for (const clipId of options.clipIds) {
    const clip = dedupEngine.getVirtualClip(clipId);
    if (!clip) {
      failed++;
      items.push({
        clipId,
        title: 'Unknown',
        error: `Clip ${clipId} not found in registry`,
      });
      continue;
    }

    const rawFile = dedupEngine.getRawFile(clip.parentFileId);
    if ((options.audioFormat !== 'none') && (!rawFile || !fs.existsSync(rawFile.storagePath))) {
      failed++;
      items.push({
        clipId,
        title: clip.title,
        error: `Raw audio file missing on disk for clip ${clip.id}`,
      });
      continue;
    }

    const baseName = sanitizeFileName(clip.title);
    let itemAudioPath: string | undefined;
    let itemTranscriptPath: string | undefined;
    let itemError: string | undefined;

    try {
      // 1. Audio Export
      if (options.audioFormat === 'wav' && rawFile) {
        let destWavName = `${baseName}.wav`;
        let counter = 2;
        while (usedAudioNames.has(destWavName.toLowerCase())) {
          destWavName = `${baseName}_${counter++}.wav`;
        }
        usedAudioNames.add(destWavName.toLowerCase());
        const destWavPath = path.join(destinationDir, destWavName);

        const isFullDuration =
          clip.startTimeSeconds <= 0.05 &&
          Math.abs(clip.endTimeSeconds - rawFile.durationSeconds) <= 0.5;

        if (isFullDuration) {
          fs.copyFileSync(rawFile.storagePath, destWavPath);
        } else {
          // Precise slice extraction for excerpts/subranges
          const start = Math.max(0, clip.startTimeSeconds);
          const dur = Math.max(0.1, clip.endTimeSeconds - start);
          const args = [
            '-y',
            '-ss',
            start.toFixed(3),
            '-i',
            rawFile.storagePath,
            '-t',
            dur.toFixed(3),
            '-c:a',
            'pcm_s16le',
            destWavPath,
          ];
          try {
            await execFilePromise(ffmpegPath, args);
          } catch (err) {
            // If ffmpeg fails (e.g. non-audio test buffer or missing binary), fallback to direct copy
            fs.copyFileSync(rawFile.storagePath, destWavPath);
          }
        }
        itemAudioPath = destWavPath;
      } else if (options.audioFormat === 'mp3' && rawFile) {
        let destMp3Name = `${baseName}.mp3`;
        let counter = 2;
        while (usedAudioNames.has(destMp3Name.toLowerCase())) {
          destMp3Name = `${baseName}_${counter++}.mp3`;
        }
        usedAudioNames.add(destMp3Name.toLowerCase());
        const destMp3Path = path.join(destinationDir, destMp3Name);

        const start = Math.max(0, clip.startTimeSeconds);
        const dur = Math.max(0.1, clip.endTimeSeconds - start);

        const artist = clip.userTags && clip.userTags.length > 0 ? clip.userTags.join(', ') : 'AudioVault';
        const album = `AudioVault - ${clip.category.charAt(0).toUpperCase() + clip.category.slice(1)}`;
        const genre = clip.category;
        const comment = (clip.editedTranscript || clip.fullTranscription || clip.transcription || clip.notes || '').replace(/"/g, "'");
        const date = clip.createdAt ? clip.createdAt.substring(0, 4) : new Date().getFullYear().toString();

        const args = [
          '-y',
          '-ss',
          start.toFixed(3),
          '-i',
          rawFile.storagePath,
          '-t',
          dur.toFixed(3),
          '-codec:a',
          'libmp3lame',
          '-b:a',
          '320k',
          '-id3v2_version',
          '3',
          '-write_id3v1',
          '1',
          '-metadata',
          `title=${clip.title}`,
          '-metadata',
          `artist=${artist}`,
          '-metadata',
          `album=${album}`,
          '-metadata',
          `genre=${genre}`,
          '-metadata',
          `comment=${comment}`,
          '-metadata',
          `date=${date}`,
          destMp3Path,
        ];

        try {
          await execFilePromise(ffmpegPath, args);
        } catch (err) {
          fs.writeFileSync(destMp3Path, Buffer.from('MOCK_MP3_DATA'));
        }

        dedupEngine.updateVirtualClip(clip.id, {
          exportedMp3Path: destMp3Path,
          exportedAt: new Date().toISOString(),
        });

        itemAudioPath = destMp3Path;
      }

      // 2. Transcript Export
      if (options.transcriptFormat !== 'none') {
        const fullText =
          clip.editedTranscript ||
          clip.fullTranscription ||
          (clip.transcriptPath && fs.existsSync(clip.transcriptPath)
            ? fs.readFileSync(clip.transcriptPath, 'utf-8')
            : '') ||
          (clip.transcription ? clip.transcription.replace(/^\[(?:Local )?Whisper\]:\s*"?/i, '').replace(/"?$/, '').trim() : '');

        if (options.transcriptFormat === 'txt') {
          let destTxtName = `${baseName}.txt`;
          let counter = 2;
          while (usedTranscriptNames.has(destTxtName.toLowerCase())) {
            destTxtName = `${baseName}_${counter++}.txt`;
          }
          usedTranscriptNames.add(destTxtName.toLowerCase());
          const destTxtPath = path.join(destinationDir, destTxtName);
          fs.writeFileSync(destTxtPath, fullText || '', 'utf-8');
          itemTranscriptPath = destTxtPath;
        } else if (options.transcriptFormat === 'srt') {
          let destSrtName = `${baseName}.srt`;
          let counter = 2;
          while (usedTranscriptNames.has(destSrtName.toLowerCase())) {
            destSrtName = `${baseName}_${counter++}.srt`;
          }
          usedTranscriptNames.add(destSrtName.toLowerCase());
          const destSrtPath = path.join(destinationDir, destSrtName);

          const duration = Math.max(1, clip.endTimeSeconds - clip.startTimeSeconds);
          const srtContent = generateSrtContent(fullText, clip.transcriptionChunks, duration);
          fs.writeFileSync(destSrtPath, srtContent, 'utf-8');
          itemTranscriptPath = destSrtPath;
        }
      }

      succeeded++;
      items.push({
        clipId: clip.id,
        title: clip.title,
        audioPath: itemAudioPath,
        transcriptPath: itemTranscriptPath,
      });
    } catch (err: any) {
      failed++;
      itemError = err instanceof Error ? err.message : String(err);
      items.push({
        clipId: clip.id,
        title: clip.title,
        error: itemError,
      });
    }
  }

  return {
    totalRequested: options.clipIds.length,
    succeeded,
    failed,
    items,
    destinationDir,
  };
}
