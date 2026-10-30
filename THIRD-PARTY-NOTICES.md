# 第三方组件与许可证

本项目（TinyAii 下载器）以 GPLv3 发布，但**内含或依赖以下第三方组件**，它们各自遵循自己的许可证。
再分发本软件时必须同时遵守这些许可。

## 随安装包一起分发的独立程序

| 组件 | 版本 | 许可证 | 说明 |
|---|---|---|---|
| **aria2**（`aria2c.exe`） | 1.37.0 | **GNU GPL v2 或更高版本** | 下载内核。本项目**未修改**其源码，以独立进程方式调用 |

### 关于 aria2 的义务

aria2 是独立可执行程序，与本项目属于「聚合」（aggregation），不要求本项目改用 GPLv2。
但因为安装包里**包含了 aria2 的二进制**，分发时需要：

1. 附带 GPLv2 许可证文本（见 <https://www.gnu.org/licenses/old-licenses/gpl-2.0.txt>）
2. 提供对应源码（本项目未修改 aria2，源码指向官方发布页：<https://github.com/aria2/aria2/releases/tag/release-1.37.0>）
3. 声明未做修改（本文件即为此声明）

如后续修改了 aria2，必须以 GPLv2 公开修改后的源码。

## 直接依赖

| 组件 | 许可证 |
|---|---|
| Tauri（`tauri`、`@tauri-apps/*`） | MIT 或 Apache-2.0 |
| React、React DOM、React Router | MIT |
| Vite、`@vitejs/plugin-react` | MIT |
| Tailwind CSS、`@tailwindcss/vite`、`tailwind-merge` | MIT |
| zustand | MIT |
| lucide-react | ISC |
| clsx | MIT |
| TypeScript | Apache-2.0 |
| Vitest | MIT |

Rust 侧依赖（`reqwest`、`serde`、`flate2` 等）绝大多数为 MIT 或 Apache-2.0，
以 `cargo` 工具生成的清单为准：

```bash
cargo install cargo-license
cargo license --manifest-path src-tauri/Cargo.toml
```

前端完整清单：

```bash
npx license-checker --summary
```

## 图标与字体

- 应用图标、界面内品牌图形：本项目原创
- 界面字体：使用系统字体，未内置任何商业字体

## 兼容性说明

GPLv2 与 GPLv3 在「链接」场景下不兼容，但 aria2 在这里是**独立进程调用**（聚合），
两个许可证可以并存。若将来把 aria2 静态链接进主程序，则整个项目必须按 GPLv2 分发，
届时本项目的 GPLv3 声明需要相应调整。
