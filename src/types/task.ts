export type TaskSourceType = 'link' | 'torrent';

export type TaskStatus = 'downloading' | 'seeding' | 'paused' | 'stopped' | 'completed' | 'failed';

export interface TaskAdvancedOptions {
  userAgent: string;
  authorization: string;
  referer: string;
  cookie: string;
  proxy: string;
}

export interface TaskBtOptions {
  autoDownloadTorrent: boolean;
  forceEncrypt: boolean;
  keepSeeding: boolean;
  seedRatio: number;
  seedTimeMinutes: number;
  trackerList?: string;
}

export interface TorrentFilePayload {
  name: string;
  contentBase64: string;
  sizeBytes?: number;
}

export interface CreateTaskPayload {
  type: TaskSourceType;
  links: string[];
  torrentFiles?: TorrentFilePayload[];
  rename: string;
  splitCount: number;
  maxConnectionsPerServer: number;
  savePath: string;
  advanced: TaskAdvancedOptions;
  btOptions?: TaskBtOptions;
}

export interface TaskFile {
  index: number;
  path: string;
  length: number;
  completedLength: number;
  selected: boolean;
}

export type TorrentTrackerStatus = 'online' | 'offline' | 'unknown';

export interface TorrentPeer {
  address: string;
  client: string;
  progress: number;
  downloadSpeedBytes: number;
  uploadSpeedBytes: number;
  flag: string;
  isSeeder: boolean;
}

export interface TorrentTracker {
  index: number;
  url: string;
  protocol: string;
  status: TorrentTrackerStatus;
}

export interface TorrentTaskDetail {
  infoHash: string;
  comment: string;
  createdAt: number | null;
  mode: string;
  pieceCount: number;
  pieceLength: number;
  uploadSpeedBytes: number;
  uploadedBytes: number;
  seeders: number;
  connections: number;
  peers: TorrentPeer[];
  trackers: TorrentTracker[];
}

export interface DownloadTaskDetail {
  torrent: TorrentTaskDetail | null;
}

export interface DownloadTask {
  id: string;
  sourceType: TaskSourceType;
  url: string;
  name: string;
  status: TaskStatus;
  splitCount: number;
  savePath: string;
  totalBytes: number;
  displayTotalBytes?: number | null;
  downloadedBytes: number;
  speedBytes: number;
  uploadSpeedBytes: number;
  createdAt: number;
  completedAt: number | null;
  seedingStartedAt?: number | null;
  bitfield: string;
  pieceLength: number;
  connections: number;
  requestedMaxConnectionsPerServer?: number;
  requestedSplitCount?: number;
  errorCode?: string;
  errorMessage?: string;
  files: TaskFile[];
  advanced: TaskAdvancedOptions;
  // 解析插件 id：记录由哪个 resolver 解析而来，用于运行中刷新链接时回溯
  resolverPluginId?: string;
  // 是否为鉴权链接（含 token/verify/expires 等会过期的参数）
  isAuthLink?: boolean;
  // 原始分享链接：刷新 token 时需要回溯到原始分享链接重新解析
  originalShareLink?: string;
}
