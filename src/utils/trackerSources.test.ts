import { describe, expect, it } from 'vitest';
import { normalizeTrackerLines, normalizeTrackerList, toAria2TrackerValue, TRACKER_REMOTE_URLS } from './trackerSources';

describe('trackerSources', () => {
  it('supports newline and comma separated trackers', () => {
    const raw = [
      'udp://tracker.one:80/announce',
      'udp://tracker.two:80/announce,udp://tracker.one:80/announce',
      '',
      'https://tracker.three/announce',
    ].join('\n');
    expect(normalizeTrackerLines(raw)).toEqual([
      'udp://tracker.one:80/announce',
      'udp://tracker.two:80/announce',
      'https://tracker.three/announce',
    ]);
  });

  it('stores normalized trackers in multiline format', () => {
    expect(normalizeTrackerList('udp://tracker.one/announce,udp://tracker.two/announce')).toBe(
      ['udp://tracker.one/announce', 'udp://tracker.two/announce'].join('\n')
    );
  });

  it('converts trackers to aria2 option format', () => {
    expect(
      toAria2TrackerValue(['udp://tracker.one/announce', 'udp://tracker.two/announce'].join('\n'))
    ).toBe('udp://tracker.one/announce,udp://tracker.two/announce');
  });

  it('provides remote fallbacks for maintained tracker sources', () => {
    expect(TRACKER_REMOTE_URLS['trackers_best.txt'].length).toBeGreaterThan(0);
    expect(TRACKER_REMOTE_URLS['best_aria2.txt'].length).toBeGreaterThan(0);
  });
});
