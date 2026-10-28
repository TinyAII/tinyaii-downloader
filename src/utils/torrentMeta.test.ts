import { describe, expect, it } from 'vitest';
import { getTorrentContentSizeFromBytes } from './torrentMeta';

function toBytes(content: string) {
  return new TextEncoder().encode(content);
}

describe('getTorrentContentSizeFromBytes', () => {
  it('reads single-file torrent total size', () => {
    const torrent = 'd4:infod6:lengthi12345e4:name8:file.bin12:piece lengthi16384e6:pieces20:aaaaaaaaaaaaaaaaaaaaee';
    expect(getTorrentContentSizeFromBytes(toBytes(torrent))).toBe(12345);
  });

  it('sums multi-file torrent total size', () => {
    const torrent = 'd4:infod5:filesld6:lengthi10e4:pathl5:a.txteed6:lengthi20e4:pathl5:b.txteee4:name3:dir12:piece lengthi16384e6:pieces20:aaaaaaaaaaaaaaaaaaaaee';
    expect(getTorrentContentSizeFromBytes(toBytes(torrent))).toBe(30);
  });

  it('returns null for invalid torrent content', () => {
    expect(getTorrentContentSizeFromBytes(toBytes('invalid'))).toBeNull();
  });
});
