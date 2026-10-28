import { describe, expect, it } from 'vitest';
import {
  mapTaskCreationError,
  normalizeUserAgentInput,
  parseUserAgentRules,
  resolveUserAgentForLinks,
  validateAndNormalizeTaskPayload,
} from './taskValidation';

const constraints = {
  minSplitCount: 1,
  maxSplitCount: 64,
  maxConnectionPerServer: 128,
  defaultSplitCount: 16,
  defaultMaxConnectionsPerServer: 16,
};

describe('task user-agent helpers', () => {
  it('normalizes user-agent input to a single line', () => {
    expect(normalizeUserAgentInput('  UA-A \n\n UA-B\t')).toBe('UA-A UA-B');
  });

  it('parses valid domain rules and ignores invalid lines', () => {
    const rules = parseUserAgentRules(`
      # comment
      *.example.com => Mozilla/5.0
      invalid-line
      api.test.com = curl/8.7.1
    `);
    expect(rules).toEqual([
      { hostPattern: '*.example.com', userAgent: 'Mozilla/5.0' },
      { hostPattern: 'api.test.com', userAgent: 'curl/8.7.1' },
    ]);
  });

  it('resolves user-agent by first matching link and rule', () => {
    const resolved = resolveUserAgentForLinks(
      ['https://download.example.com/file.zip', 'https://backup.site.com/a'],
      '*.example.com => Custom-UA\nsite.com => Site-UA',
      'Fallback-UA'
    );
    expect(resolved).toEqual({
      userAgent: 'Custom-UA',
      matchedPattern: '*.example.com',
    });
  });

  it('falls back to global user-agent when no rule matches', () => {
    const resolved = resolveUserAgentForLinks(
      ['https://mirror.unknown.org/file.bin'],
      '*.example.com => Custom-UA',
      'Fallback-UA'
    );
    expect(resolved).toEqual({
      userAgent: 'Fallback-UA',
      matchedPattern: '',
    });
  });

  it('maps bilibili resolver errors directly', () => {
    expect(mapTaskCreationError('哔哩解析失败：未识别到 BV/av 视频编号')).toBe(
      '添加任务失败：哔哩解析失败：未识别到 BV/av 视频编号'
    );
  });

  it('maps quark session errors directly', () => {
    expect(mapTaskCreationError('检测到夸克链接，但未配置夸克登录态。请先在扩展中心完成登录态配置。')).toBe(
      '添加任务失败：检测到夸克链接，但未配置夸克登录态。请先在扩展中心完成登录态配置。'
    );
  });

  it('accepts torrent payload with local files', () => {
    const payload = validateAndNormalizeTaskPayload({
      type: 'torrent',
      links: [],
      torrentFiles: [{
        name: 'demo.torrent',
        contentBase64: 'ZmFrZS10b3JyZW50',
        sizeBytes: 128,
      }],
      rename: '',
      splitCount: 8,
      maxConnectionsPerServer: 16,
      savePath: 'C:/downloads',
      advanced: {
        userAgent: '',
        authorization: '',
        referer: '',
        cookie: '',
        proxy: '',
      },
    }, constraints);
    expect(payload.torrentFiles).toEqual([{
      name: 'demo.torrent',
      contentBase64: 'ZmFrZS10b3JyZW50',
      sizeBytes: 128,
    }]);
  });

  it('rejects torrent payload without files', () => {
    expect(() => validateAndNormalizeTaskPayload({
      type: 'torrent',
      links: [],
      torrentFiles: [],
      rename: '',
      splitCount: 8,
      maxConnectionsPerServer: 16,
      savePath: 'C:/downloads',
      advanced: {
        userAgent: '',
        authorization: '',
        referer: '',
        cookie: '',
        proxy: '',
      },
    }, constraints)).toThrow('请先选择至少一个种子文件');
  });
});
