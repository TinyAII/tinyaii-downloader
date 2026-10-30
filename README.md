# TinyAii 下载器

基于 Tauri 2 + React 的桌面下载工具，Windows 平台。下载内核用 aria2，界面自带令牌保护的本地 API 与 MCP 入口。

## 功能

- **下载**：直链与种子、多分片（默认 128）、单服务器连接数可调
- **BT**：Tracker 列表（可在线更新）、做种策略、加密
- **限速**：每任务上行 / 下行 / 低速中止阈值；全局限速
- **网络**：HTTP / HTTPS / SOCKS5 代理，支持按域名绕过
- **GitHub 加速**：可编辑的镜像前缀列表，带测速；新建任务可单次覆盖
- **本地 API**：`127.0.0.1:17890`，`X-Api-Token` 鉴权，**默认关闭**，在「本地 API」页开启
- **MCP**：同端口 `/mcp`，支持 HTTP 传输的客户端可直接接入
- **更新检查**：基于 BumpAPI 的发布通道（stable / beta）

## 技术栈

| 层 | 选型 |
|---|---|
| 外壳 | Tauri 2（Rust） |
| 界面 | React + TypeScript + Tailwind CSS + zustand |
| 下载内核 | aria2（RPC 模式，独立进程） |

## 开发

```bash
npm install
npm run tauri dev      # 开发模式
npm run tauri build    # 打包（产物在 src-tauri/target/release/bundle/）
npx tsc --noEmit       # 类型检查
npx vitest run         # 单元测试
```

打包需要：Node 18+、Rust 稳定版、Windows 上的 MSVC 构建工具。

## 本地 API

开启后接口在 `http://127.0.0.1:17890`，令牌文件在
`%APPDATA%\com.xiaojie.tauri-app\api-token`。完整接口说明见
[`docs/api_local_20261028.md`](docs/api_local_20261028.md)。

## 源码

- GitHub：<https://github.com/TinyAII/tinyaii-downloader>
- Gitee（镜像）：<https://gitee.com/ctsq/tinyaii-downloader>

## 开源协议

本项目以 **GNU General Public License v3.0** 发布，全文见 [LICENSE](LICENSE)。

这意味着你可以自由使用、修改、再分发，但**再分发时必须同样以 GPLv3 提供完整源码**。

第三方组件的许可证见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)，
其中 aria2 采用 GPLv2 或更高版本，与本项目分开授权。
