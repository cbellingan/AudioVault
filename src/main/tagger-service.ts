import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import * as util from 'util';
import { getFfmpegPath } from './export-service';

const execFilePromise = util.promisify(execFile);

export interface AudioTags {
  title?: string;
  artist?: string;
  location?: string;
  comment?: string;
}

export class TaggerService {
  private ffmpegPath: string;

  constructor(customFfmpegPath?: string) {
    this.ffmpegPath = customFfmpegPath || getFfmpegPath();
  }

  /**
   * Embeds title, artist, and location directly into the audio file container
   * losslessly without re-encoding (-c copy). Supports WAV, MP3, FLAC, M4A, OGG.
   */
  public async tagAudioFile(filePath: string, tags: AudioTags): Promise<boolean> {
    if (!filePath || !fs.existsSync(filePath)) {
      return false;
    }

    const ext = path.extname(filePath).toLowerCase();
    const supportedExts = ['.wav', '.mp3', '.flac', '.m4a', '.aac', '.ogg', '.aif', '.aiff'];
    if (!supportedExts.includes(ext)) {
      return false;
    }

    const tempOut = path.join(
      path.dirname(filePath),
      `.__tag_tmp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`
    );

    const args: string[] = ['-y', '-i', filePath, '-c', 'copy'];

    if (tags.title !== undefined) {
      args.push('-metadata', `title=${tags.title}`);
    }
    if (tags.artist !== undefined) {
      args.push('-metadata', `artist=${tags.artist}`);
    }
    if (tags.location !== undefined) {
      const locStr = tags.location.trim();
      if (locStr) {
        args.push('-metadata', `comment=Location: ${locStr}`);
        args.push('-metadata', `location=${locStr}`);
      } else {
        // Clear comment/location
        args.push('-metadata', 'comment=');
        args.push('-metadata', 'location=');
      }
    }

    args.push(tempOut);

    try {
      await execFilePromise(this.ffmpegPath, args);
      if (fs.existsSync(tempOut) && fs.statSync(tempOut).size > 0) {
        fs.copyFileSync(tempOut, filePath);
        fs.unlinkSync(tempOut);
        return true;
      }
      return false;
    } catch (err) {
      console.warn(`[AudioVault Tagger] Non-fatal: could not tag audio file ${filePath}:`, err);
      if (fs.existsSync(tempOut)) {
        try {
          fs.unlinkSync(tempOut);
        } catch {
          // ignore
        }
      }
      return false;
    }
  }
}

export const taggerService = new TaggerService();
