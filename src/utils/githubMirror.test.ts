import { describe, expect, it } from 'vitest';
import { applyGithubMirror, isGithubHostedUrl, resolveMirror, stripProtocol, DIRECT_MIRROR } from './githubMirror';

describe('githubMirror', () => {
  it('只改写 github 域名的链接', () => {
    const url = 'https://github.com/aria2/aria2/releases/download/release-1.37.0/a.zip';
    expect(applyGithubMirror(url, 'https://gh-proxy.com/')).toBe(
      'https://gh-proxy.com/https://github.com/aria2/aria2/releases/download/release-1.37.0/a.zip'
    );
  });

  it('非 github 链接原样返回', () => {
    const url = 'https://example.com/file.iso';
    expect(applyGithubMirror(url, 'https://gh-proxy.com/')).toBe(url);
  });

  it('前缀为空时直连', () => {
    const url = 'https://github.com/a/b/releases/download/v1/c.exe';
    expect(applyGithubMirror(url, '')).toBe(url);
    expect(applyGithubMirror(url, '   ')).toBe(url);
  });

  it('前缀缺少结尾斜杠时自动补上', () => {
    const url = 'https://raw.githubusercontent.com/a/b/main/c.txt';
    expect(applyGithubMirror(url, 'https://ghproxy.net')).toBe(
      'https://ghproxy.net/https://raw.githubusercontent.com/a/b/main/c.txt'
    );
  });

  it('识别可改写的域名', () => {
    expect(isGithubHostedUrl('https://github.com/x')).toBe(true);
    expect(isGithubHostedUrl('https://objects.githubusercontent.com/x')).toBe(true);
    expect(isGithubHostedUrl('not a url')).toBe(false);
    expect(isGithubHostedUrl('https://github.com.example.com/x')).toBe(false);
  });

  it('显示用地址去掉协议前缀', () => {
    expect(stripProtocol('https://gh-proxy.com/')).toBe('gh-proxy.com/');
    expect(stripProtocol('http://cdn.akaere.online/')).toBe('cdn.akaere.online/');
    expect(stripProtocol('')).toBe('');
  });

  it('选中项不存在时回退到列表首项', () => {
    const list = [DIRECT_MIRROR, { id: 'm', label: 'm', prefix: 'https://m/' }];
    expect(resolveMirror(list, 'missing').id).toBe('direct');
    expect(resolveMirror(undefined, 'x').id).toBe('direct');
  });
});
