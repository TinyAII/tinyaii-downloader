export const TRACKER_SOURCE_OPTIONS = [
  { label: 'ngosang 最佳', value: 'trackers_best.txt' },
  { label: 'ngosang UDP 全量', value: 'trackers_balanced.txt' },
  { label: 'ngosang HTTPS 精简', value: 'trackers_minimal.txt' },
  { label: 'XIU2 最佳(aria2)', value: 'best_aria2.txt' },
  { label: 'XIU2 全量(aria2)', value: 'all_aria2.txt' },
  { label: 'XIU2 HTTP(aria2)', value: 'http_aria2.txt' },
  { label: 'XIU2 NoHTTP(aria2)', value: 'nohttp_aria2.txt' },
  { label: '自定义', value: 'custom' },
] as const;

export const TRACKER_REMOTE_URLS: Record<string, string[]> = {
  'trackers_best.txt': [
    'https://ngosang.github.io/trackerslist/trackers_best.txt',
    'https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best.txt',
  ],
  'trackers_balanced.txt': [
    'https://ngosang.github.io/trackerslist/trackers_all_udp.txt',
    'https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_all_udp.txt',
  ],
  'trackers_minimal.txt': [
    'https://ngosang.github.io/trackerslist/trackers_all_https.txt',
    'https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_all_https.txt',
  ],
  'best_aria2.txt': [
    'https://cf.trackerslist.com/best_aria2.txt',
    'https://raw.githubusercontent.com/XIU2/TrackersListCollection/master/best_aria2.txt',
  ],
  'all_aria2.txt': [
    'https://cf.trackerslist.com/all_aria2.txt',
    'https://raw.githubusercontent.com/XIU2/TrackersListCollection/master/all_aria2.txt',
  ],
  'http_aria2.txt': [
    'https://cf.trackerslist.com/http_aria2.txt',
    'https://raw.githubusercontent.com/XIU2/TrackersListCollection/master/http_aria2.txt',
  ],
  'nohttp_aria2.txt': [
    'https://cf.trackerslist.com/nohttp_aria2.txt',
    'https://raw.githubusercontent.com/XIU2/TrackersListCollection/master/nohttp_aria2.txt',
  ],
  custom: [],
};

export function normalizeTrackerLines(raw: string) {
  return Array.from(
    new Set(
      raw
        .replace(/\r/g, '\n')
        .split(/[\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

export function normalizeTrackerList(raw: string) {
  return normalizeTrackerLines(raw).join('\n');
}

export function toAria2TrackerValue(raw: string) {
  return normalizeTrackerLines(raw).join(',');
}
