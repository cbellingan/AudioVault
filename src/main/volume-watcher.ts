import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { DiscoveredAudioFile, VolumeDetectedEvent } from '../shared/types';
import { DedupEngine } from './dedup-engine';

const execAsync = promisify(exec);

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a', '.aif', '.aiff', '.flac']);

export class VolumeWatcher {
  private dedupEngine: DedupEngine;
  private isPathInProgressFn?: (filePath: string) => boolean;
  private isVolumeInProgressFn?: (volumePath: string) => boolean;

  constructor(dedupEngine: DedupEngine) {
    this.dedupEngine = dedupEngine;
  }

  public setInProgressCheckers(
    isFileInProgress: (filePath: string) => boolean,
    isVolumeInProgress: (volumePath: string) => boolean
  ) {
    this.isPathInProgressFn = isFileInProgress;
    this.isVolumeInProgressFn = isVolumeInProgress;
  }

  /**
   * Scans macOS /Volumes for external devices, SD cards, and USB media containing audio files.
   */
  public async scanConnectedVolumes(): Promise<VolumeDetectedEvent[]> {
    const events: VolumeDetectedEvent[] = [];
    const volumesDir = '/Volumes';

    if (!fs.existsSync(volumesDir)) {
      return events;
    }

    try {
      const volumeNames = fs.readdirSync(volumesDir);
      for (const volName of volumeNames) {
        // Skip Macintosh HD or root volume symlinks
        if (volName === 'Macintosh HD' || volName.startsWith('.')) continue;

        const volumePath = path.join(volumesDir, volName);
        if (this.isVolumeInProgressFn && this.isVolumeInProgressFn(volumePath)) {
          // Volume is actively being ingested in the background pipeline
          continue;
        }

        try {
          const stats = fs.statSync(volumePath);
          if (!stats.isDirectory()) continue;

          const discovered = this.scanDirectoryForAudio(volumePath, volName);
          if (discovered.length > 0) {
            const newFilesCount = discovered.filter((f) => !f.isAlreadyImported && !f.isDeleted).length;
            const deletedFilesCount = discovered.filter((f) => f.isDeleted).length;
            events.push({
              volumePath,
              volumeName: volName,
              totalFilesCount: discovered.length,
              newFilesCount,
              deletedFilesCount,
              files: discovered,
            });
          }
        } catch (err) {
          // Volume may be unmounted or inaccessible
          continue;
        }
      }
    } catch (err) {
      console.error('Error scanning /Volumes:', err);
    }

    return events;
  }

  /**
   * Scans a target directory (root and 1 level deep for audio recorder structures).
   */
  public scanDirectoryForAudio(dirPath: string, volumeName = path.basename(dirPath)): DiscoveredAudioFile[] {
    const results: DiscoveredAudioFile[] = [];

    const scanDir = (currentPath: string, depth = 0) => {
      if (depth > 2) return;
      try {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const fullPath = path.join(currentPath, entry.name);

          if (entry.isDirectory()) {
            scanDir(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (AUDIO_EXTENSIONS.has(ext)) {
              try {
                const stat = fs.statSync(fullPath);
                const fingerprint = this.dedupEngine.computeFileFingerprint(fullPath);
                const isInProgress = this.isPathInProgressFn ? this.isPathInProgressFn(fullPath) : false;
                const isAlreadyImported = this.dedupEngine.isFingerprintImported(fingerprint) || isInProgress;
                const isDeleted = this.dedupEngine.isDeletedFile(fingerprint, fullPath);

                results.push({
                  path: fullPath,
                  name: entry.name,
                  sizeBytes: stat.size,
                  modifiedTime: stat.mtime.toISOString(),
                  volumePath: dirPath,
                  volumeName,
                  isAlreadyImported,
                  isDeleted,
                  fingerprint,
                });
              } catch (err) {
                // File might be locked or unreadable
              }
            }
          }
        }
      } catch (err) {
        // Directory permission or unreadable
      }
    };

    scanDir(dirPath, 0);
    return results;
  }

  /**
   * Safely and cleanly unmounts a mounted external volume using macOS diskutil.
   */
  public async unmountVolume(volumePath: string): Promise<{ success: boolean; message: string }> {
    if (process.platform !== 'darwin') {
      return { success: true, message: 'Clean unmount only required on macOS.' };
    }

    try {
      const { stdout } = await execAsync(`diskutil unmount "${volumePath}"`);
      return { success: true, message: stdout.trim() };
    } catch (err: any) {
      // If busy, try force unmount if user requested
      try {
        const { stdout } = await execAsync(`diskutil unmount force "${volumePath}"`);
        return { success: true, message: stdout.trim() };
      } catch (forceErr: any) {
        return {
          success: false,
          message: `Failed to unmount volume: ${err.message || err}`,
        };
      }
    }
  }
}
