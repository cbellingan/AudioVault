import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

function getAudioMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.wav':
      return 'audio/wav';
    case '.mp3':
      return 'audio/mpeg';
    case '.m4a':
    case '.aac':
      return 'audio/mp4';
    case '.flac':
      return 'audio/flac';
    case '.ogg':
      return 'audio/ogg';
    default:
      return 'application/octet-stream';
  }
}

interface MockResponseOptions {
  status: number;
  statusText?: string;
  headers: Record<string, string>;
}

class MockResponse {
  bodyStream: fs.ReadStream | null;
  status: number;
  statusText: string;
  headers: Record<string, string>;

  constructor(body: any, init: MockResponseOptions) {
    this.bodyStream = body;
    this.status = init.status;
    this.statusText = init.statusText || (init.status === 200 ? 'OK' : init.status === 206 ? 'Partial Content' : 'Error');
    this.headers = init.headers;
  }
}

function handleAudioRangeRequest(filePath: string, rangeHeader: string | null): MockResponse {
  const stat = fs.statSync(filePath);
  const totalSize = stat.size;
  const mimeType = getAudioMimeType(filePath);

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;
      const clampedEnd = Math.min(end, totalSize - 1);
      const chunkSize = clampedEnd - start + 1;

      if (start >= totalSize || start > clampedEnd) {
        return new MockResponse(null, {
          status: 416,
          statusText: 'Range Not Satisfiable',
          headers: {
            'Content-Range': `bytes */${totalSize}`,
          },
        });
      }

      const stream = fs.createReadStream(filePath, { start, end: clampedEnd });
      return new MockResponse(stream, {
        status: 206,
        statusText: 'Partial Content',
        headers: {
          'Content-Type': mimeType,
          'Content-Range': `bytes ${start}-${clampedEnd}/${totalSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
        },
      });
    }
  }

  const stream = fs.createReadStream(filePath);
  return new MockResponse(stream, {
    status: 200,
    statusText: 'OK',
    headers: {
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(totalSize),
    },
  });
}

describe('Audio Protocol Seeking & HTTP Range Requests', () => {
  let tempDir: string;
  let sampleWavPath: string;
  const sampleFileSize = 10000;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiovault-range-test-'));
    sampleWavPath = path.join(tempDir, 'test-seek.wav');
    const buf = Buffer.alloc(sampleFileSize);
    for (let i = 0; i < sampleFileSize; i++) {
      buf[i] = i % 256;
    }
    fs.writeFileSync(sampleWavPath, buf);
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('correctly maps audio file extensions to MIME types', () => {
    expect(getAudioMimeType('track.wav')).toBe('audio/wav');
    expect(getAudioMimeType('TRACK.WAV')).toBe('audio/wav');
    expect(getAudioMimeType('take.mp3')).toBe('audio/mpeg');
    expect(getAudioMimeType('memo.m4a')).toBe('audio/mp4');
    expect(getAudioMimeType('sound.flac')).toBe('audio/flac');
    expect(getAudioMimeType('other.bin')).toBe('application/octet-stream');
  });

  it('returns status 200 with Accept-Ranges and full length when no Range header is provided', () => {
    const res = handleAudioRangeRequest(sampleWavPath, null);
    expect(res.status).toBe(200);
    expect(res.statusText).toBe('OK');
    expect(res.headers['Content-Type']).toBe('audio/wav');
    expect(res.headers['Accept-Ranges']).toBe('bytes');
    expect(res.headers['Content-Length']).toBe(String(sampleFileSize));
    res.bodyStream?.destroy();
  });

  it('returns status 206 with Content-Range for suffix range (bytes=0-)', () => {
    const res = handleAudioRangeRequest(sampleWavPath, 'bytes=0-');
    expect(res.status).toBe(206);
    expect(res.statusText).toBe('Partial Content');
    expect(res.headers['Content-Type']).toBe('audio/wav');
    expect(res.headers['Accept-Ranges']).toBe('bytes');
    expect(res.headers['Content-Range']).toBe(`bytes 0-${sampleFileSize - 1}/${sampleFileSize}`);
    expect(res.headers['Content-Length']).toBe(String(sampleFileSize));
    res.bodyStream?.destroy();
  });

  it('returns status 206 with correct byte slice when seeking to a mid-point (e.g. bytes=2500-)', async () => {
    const seekOffset = 2500;
    const res = handleAudioRangeRequest(sampleWavPath, `bytes=${seekOffset}-`);
    expect(res.status).toBe(206);
    expect(res.statusText).toBe('Partial Content');
    expect(res.headers['Accept-Ranges']).toBe('bytes');
    expect(res.headers['Content-Range']).toBe(`bytes ${seekOffset}-${sampleFileSize - 1}/${sampleFileSize}`);
    expect(res.headers['Content-Length']).toBe(String(sampleFileSize - seekOffset));

    const stream = res.bodyStream!;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const receivedBuffer = Buffer.concat(chunks);
    expect(receivedBuffer.length).toBe(sampleFileSize - seekOffset);
    expect(receivedBuffer[0]).toBe(seekOffset % 256);
  });

  it('returns status 206 with bounded byte slice (bytes=1000-1999)', async () => {
    const res = handleAudioRangeRequest(sampleWavPath, 'bytes=1000-1999');
    expect(res.status).toBe(206);
    expect(res.headers['Content-Range']).toBe(`bytes 1000-1999/${sampleFileSize}`);
    expect(res.headers['Content-Length']).toBe('1000');

    const stream = res.bodyStream!;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const receivedBuffer = Buffer.concat(chunks);
    expect(receivedBuffer.length).toBe(1000);
    expect(receivedBuffer[0]).toBe(1000 % 256);
    expect(receivedBuffer[receivedBuffer.length - 1]).toBe(1999 % 256);
  });

  it('returns status 416 Range Not Satisfiable when range is beyond file size', () => {
    const res = handleAudioRangeRequest(sampleWavPath, 'bytes=50000-');
    expect(res.status).toBe(416);
    expect(res.statusText).toBe('Range Not Satisfiable');
    expect(res.headers['Content-Range']).toBe(`bytes */${sampleFileSize}`);
  });
});
