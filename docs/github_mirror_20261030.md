# GitHub 加速（镜像前缀）说明

> 2026-10-30。对应版本 1.0.1 之后。

## 为什么做这个

GitHub Release 的文件在国内网络下时通时断。原来只能靠用户自己在系统层面开代理（设置里那套 `proxyProtocol/proxyHost`，走 aria2 的 `all-proxy`），门槛高。

这次加的是**镜像前缀**：把
```
https://github.com/owner/repo/releases/download/v1/file.zip
```
改写成
```
https://gh-proxy.com/https://github.com/owner/repo/releases/download/v1/file.zip
```
由加速站代取。两件事要分清：

| | 代理（已有） | 镜像前缀（本次） |
|---|---|---|
| 作用点 | aria2 全局 `all-proxy` | 建任务前改写链接字符串 |
| 影响范围 | 所有任务 | 只影响命中白名单的链接 |
| 需要账号 | 可能需要 | 不需要 |

## 实测数据（2026-10-30，目标为 aria2 release 压缩包，取 1 字节）

| 地址 | 状态 | 耗时 |
|---|---|---|
| 直连 github.com | 206 | 0.73s |
| `gh-proxy.com` | 206 | 0.87s |
| `cdn.akaere.online` | 206 | 0.89s |
| `gh.dpik.top` | 206 | 1.16s |
| `ghproxy.net` | **超时** | 12s（10-30 复测已失效，已从内置列表移除） |
| `gh-proxy.net` | 302 | 2.49s（未验证能否真下） |
| `ghfast.top` / `gh.llkk.cc` | 超时 | 12s |
| `github.moeyy.xyz` / `hub.gitmirror.com` / `ghproxy.cc` / `gh.xxooo.cf` | 连不上 | — |
| `ghproxylist.com` | 200 | 返回 30KB **HTML 页面**——它是加速站索引网站，不是代理前缀 |

### 内置默认列表（v1.0.1 之后）
1. 直连 GitHub（默认选中）
2. `gh-proxy.com`
3. `gh.dpik.top`
4. `cdn.akaere.online`

`ghproxylist.com` 可以当"去哪找可用地址"的入口，但它本身不能当前缀用：拿它拼 URL 会下载到一个网页。

结论：**7 个候选挂了 4 个**，且直连当时比两个可用镜像之一快 9 倍。所以：

- 默认值是 **直连**，不是加速
- 加速地址做成**用户可编辑列表**，不写死在代码里

## 实现

| 位置 | 内容 |
|---|---|
| `src/utils/githubMirror.ts` | `applyGithubMirror(url, prefix)`、`isGithubHostedUrl`、`resolveMirror` |
| `src/store/settings/types.ts` | `githubMirrorId`（当前选中）与 `githubMirrorList`（可编辑列表） |
| `src/store/tasks.ts` | `createTasks` 在调用 `aria2CreateTasks` 前改写 `links`，命中时写一条开发者日志 |
| `src/pages/Settings/AdvancedSettings.tsx` | 新增「GitHub 加速」区块：逐条「测试」/「使用」/「删除」，支持添加自定义前缀 |
| `src-tauri/src/lib.rs` | 新增命令 `app_probe_url`：带 `Range: bytes=0-0` 取 1 字节，返回状态码与耗时（走 Rust，绕开浏览器 CORS） |

### 白名单域名
只有这些域名的链接会被改写，其它一律不动：
`github.com`、`www.github.com`、`codeload.github.com`、`raw.githubusercontent.com`、`objects.githubusercontent.com`、`release-assets.githubusercontent.com`

## 已知风险

1. **隐私**：加速站能看到你下载的文件和 URL。
2. **完整性**：加速站理论上可以替换文件。要防这一手，建任务时填 `checksum`（`sha-256=<hex>`），校验不过会直接标记失败（`errorCode=32`）。
3. **测出来的快 ≠ 下载快**：测试只取 1 字节，反映的是首包时延；大文件的实际带宽可能不同。
4. **不覆盖插件解析结果**：改写发生在插件解析之后，所以解析出的 GitHub 直链同样会被改写；但插件返回的非 GitHub 链接不动。

## 怎么用

设置 → 进阶设置 → GitHub 加速。每条显示 **名称 + 网址（省略 https://）+ 延迟**：

- 点延迟文字（`0.87s`）重新测试；颜色分级：≤1.5s 绿、≤3s 琥珀、>3s 或失败 **红**
- 点「使用」选中；已选中的显示为「使用中」
- 点「编辑」可改名称与前缀，改错了不用删了重建
- 点「删除」移除（直连项不可删）
- 底部「添加自定义」可加自己的前缀

选好之后，新建的 GitHub 任务会自动带上前缀；已存在的任务不受影响。

### 单任务临时指定

「新建任务」弹窗里多了一个「GitHub 加速」勾选：

- **默认状态跟随设置**：设置里选了加速，勾选框就是勾上的；设置是直连，就是不勾
- 勾上后出现下拉，默认是设置里选的那个，可以临时换成列表里任意一个
- **不勾 = 本次任务强制直连**（即使设置里选了加速）
- 这个选择**只作用于本次任务**，不写回设置，下次打开弹窗恢复默认

实现上：`createTasks(payload, mirrorPrefixOverride?)`，`undefined` 表示跟随设置，`null`/空串表示本次直连，其它值为本次指定前缀。

加速站挂了就点「删除」，或添加一个新的前缀。
