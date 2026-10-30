export interface ReleaseSource {
  id: 'github' | 'gitee';
  label: string;
  url: string;
}

// 发布页固定地址：用 releases 列表而不是 releases/tag/vX，
// 避免某个版本的 tag 还没推上去时点开是 404
export const RELEASE_SOURCES: ReleaseSource[] = [
  {
    id: 'github',
    label: 'GitHub',
    url: 'https://github.com/TinyAII/tinyaii-downloader/releases',
  },
  {
    id: 'gitee',
    label: 'Gitee',
    url: 'https://gitee.com/ctsq/tinyaii-downloader/releases',
  },
];
