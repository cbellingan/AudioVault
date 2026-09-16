import fs from 'fs';
import path from 'path';
import { DedupEngine } from './dedup-engine';
import { VolumeWatcher } from './volume-watcher';
import { ImportPlan, ImportPlanItem } from '../shared/types';

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a', '.flac', '.aif', '.aiff', '.aac', '.ogg']);

export interface CreateImportPlanOptions {
  paths: string[];
  dedupEngine: DedupEngine;
  volumeWatcher?: VolumeWatcher;
  sourceDescription?: string;
  isPathInProgressFn?: (filePath: string) => boolean;
}

/**
 * Discovers audio candidates from a list of files or directories,
 * and analyzes duplicates and exclusions without making any disk or registry changes.
 */
export function createImportPlan(options: CreateImportPlanOptions): ImportPlan {
  const { paths, dedupEngine, volumeWatcher, isPathInProgressFn } = options;
  const discoveredPaths: string[] = [];

  for (const p of paths) {
    if (!fs.existsSync(p)) continue;
    try {
      const stat = fs.statSync(p);
      if (stat.isDirectory()) {
        if (volumeWatcher) {
          const files = volumeWatcher.scanDirectoryForAudio(p);
          for (const f of files) discoveredPaths.push(f.path);
        } else {
          scanDirFallback(p, discoveredPaths);
        }
      } else if (stat.isFile()) {
        const ext = path.extname(p).toLowerCase();
        if (AUDIO_EXTENSIONS.has(ext)) {
          discoveredPaths.push(p);
        }
      }
    } catch {
      // Ignore unreadable paths
    }
  }

  // De-duplicate discovered paths
  const uniquePaths = Array.from(new Set(discoveredPaths));
  const items: ImportPlanItem[] = [];

  for (const filePath of uniquePaths) {
    try {
      const filename = path.basename(filePath);
      const stat = fs.statSync(filePath);
      const fingerprint = dedupEngine.computeFileFingerprint(filePath);
      const isInProgress = isPathInProgressFn ? isPathInProgressFn(filePath) : false;
      const isDuplicate = dedupEngine.isFingerprintImported(fingerprint, filePath) || isInProgress;
      const isExcluded = dedupEngine.isDeletedFile(fingerprint, filePath);

      if (isExcluded) {
        items.push({
          path: filePath,
          name: filename,
          sizeBytes: stat.size,
          status: 'excluded',
          explanation: 'Previously excluded / deleted recording.',
        });
      } else if (isDuplicate) {
        items.push({
          path: filePath,
          name: filename,
          sizeBytes: stat.size,
          status: 'duplicate',
          explanation: 'Already imported into AudioVault.',
        });
      } else {
        items.push({
          path: filePath,
          name: filename,
          sizeBytes: stat.size,
          status: 'new',
          explanation: 'New recording ready for ingest.',
        });
      }
    } catch {
      // Ignore unreadable files
    }
  }

  const newFilesCount = items.filter((i) => i.status === 'new').length;
  const duplicatesCount = items.filter((i) => i.status === 'duplicate').length;
  const excludedCount = items.filter((i) => i.status === 'excluded').length;

  let desc = options.sourceDescription;
  if (!desc) {
    if (paths.length === 1) {
      desc = path.basename(paths[0]);
    } else if (paths.length > 1) {
      desc = `${paths.length} selected sources`;
    } else {
      desc = 'Selected source';
    }
  }

  return {
    sourceDescription: desc,
    totalFound: items.length,
    newFilesCount,
    duplicatesCount,
    excludedCount,
    items,
    destinationFolder: dedupEngine.getRawDir(),
  };
}

function scanDirFallback(dir: string, out: string[], depth = 0) {
  if (depth > 2) return;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDirFallback(full, out, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTENSIONS.has(ext)) {
          out.push(full);
        }
      }
    }
  } catch {
    // Ignore permissions or read failures
  }
}
