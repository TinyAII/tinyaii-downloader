# UI 升级与完善记录 (2026-03-21)

## 1. 任务卡片 UI 升级
**文件**: `src/components/task/TaskList.tsx`
**改动点**:
- 引入了类似 Motrix Next 的现代卡片设计。
- 添加了鼠标悬浮 (`hover`) 时的渐变和阴影效果。
- 隐藏了默认的操作按钮，仅在卡片处于 `hover` 状态时平滑显示 (`opacity-0 group-hover:opacity-100`)。
- 操作按钮升级为圆形背景，根据不同操作（开始/暂停/停止/文件夹/删除）分配了对应的主题色（`primary`, `amber`, `red` 等）。
- 整合了 `@tauri-apps/plugin-opener` 插件，在任务卡片上点击“文件夹”图标即可直接调用系统资源管理器定位并选中下载的文件。

## 2. 底部全局下载速度悬浮窗
**文件**: `src/pages/Downloading.tsx`
**改动点**:
- 将右下角原本无数据的按钮替换为实时更新的全局速度展示悬浮组件。
- 采用了毛玻璃 (`backdrop-blur-md`) 半透明白色背景设计。
- 动态汇总所有当前 `downloading` 状态任务的速度 (`speedBytes`) 进行格式化展示。
- 从 `Completed.tsx` 中移除了无用的下载速度悬浮窗，保持页面职责专一。

## 3. 依赖变更
- 新增调用 `@tauri-apps/plugin-opener` 用于打开文件所在目录 (`revealItemInDir`, `openPath`)。

## 4. 双击任务条交互
**文件**: `src/components/task/TaskList.tsx`
**改动点**:
- 下载中列表新增“双击任务条切换状态”能力。
- 双击下载中的任务会触发暂停，双击已暂停/已停止/失败任务会触发恢复下载。
- 通过延时单击机制区分单击与双击，避免双击时误触发详情弹窗。

## 5. 检查与打包结果
- `npm run test`：通过（6/6）。
- `npm run build`：通过。
- `npm run tauri build`：通过。
- 安装包产物：`src-tauri/target/release/bundle/nsis/tauri-app_0.1.0_x64-setup.exe`。

## 6. 任务条按钮与详情分区调整
**文件**: `src/components/task/TaskList.tsx`
**改动点**:
- 任务条操作按钮改为常驻显示，不再依赖 hover 才显示。
- 新增“复制链接”按钮，点击后复制当前任务 URL。

**文件**: `src/components/task/TaskDetailsModal.tsx`
**改动点**:
- 将下载块从“概要”中拆分为独立分区，分区名称改为“情况”。
- “情况”分区只显示下载块画布，不混入其他信息。

## 7. 文件分区改为目标数据列样式
**文件**: `src/components/task/TaskDetailsModal.tsx`
**改动点**:
- 文件分区从树形结构改为扁平数据表，字段与参考图一致。
- 表头调整为 `# / 文件名 / 扩展名 / % / √ / 大小`。
- 数据分别展示文件序号、名称、扩展名、进度百分比、已完成大小、总大小。

## 8. 活动分区与任务条按钮语义调整
**文件**: `src/components/task/TaskDetailsModal.tsx`
**改动点**:
- 分区名称恢复为“活动”，并按参考图展示下载块与关键指标表。
- 活动指标新增 `任务进度`、`文件大小`、`下载速度`、`连接数`。
- 文件大小行在下载中显示“剩余时间”，暂停或非下载状态不显示剩余时间。

**文件**: `src/components/task/TaskList.tsx`
**改动点**:
- 下载中按钮语义调整为：下载中显示“暂停”，未下载状态显示“恢复任务”。
- 原“停止”按钮替换为“删除任务”。
- 原“删除”按钮替换为“任务详情”。

## 9. 活动页速度与剩余时间平滑处理
**文件**: `src/components/task/TaskDetailsModal.tsx`
**改动点**:
- 新增速度平滑状态，使用指数移动平均降低瞬时抖动。
- 活动分区“下载速度”改为展示平滑后的速度值。
- 活动分区“文件大小”中的剩余时间改为基于平滑速度计算，读数更稳定。

## 10. 概要分区样式对齐与打包
**文件**: `src/components/task/TaskDetailsModal.tsx`
**改动点**:
- 概要分区改为表格卡片样式，新增外层边框与浅色背景。
- 每行采用左侧标签、右侧内容的双列结构，行间和列间均有边线分割。
- 任务状态改为标签样式展示，视觉与参考图一致。

**构建与打包结果**:
- `npm run test`：通过（6/6）。
- `npm run build`：通过。
- `npm run tauri build`：通过。
- 安装包：`src-tauri/target/release/bundle/nsis/tauri-app_0.1.0_x64-setup.exe`。

## 11. 右侧抽屉详情、下载块独立页与分片数修复
**文件**: `src/components/task/TaskDetailsModal.tsx`
**改动点**:
- 任务详情改为通过 Portal 挂载到 `document.body`，固定在全局右侧抽屉展示，不再受页面布局影响居中。
- 新增“情况”分页，下载块单独展示为独立页面。
- “活动”分页调整为仅展示核心指标（任务进度、文件大小、下载速度、连接数）。
- 保留“文件”分页右侧下载块卡片，满足文件区右侧并排查看下载块的需求。

**文件**: `src/components/task/NewTaskModal.tsx`
**改动点**:
- 分片数默认值改为读取基础设置中的“单服务器最大连接数”（当前默认 64）。
- 打开新建任务窗口时，分片数推荐值与回退值均按设置值与约束范围共同计算，避免回退到旧默认值 16。

**文件**: `src-tauri/src/lib.rs`
**改动点**:
- 将后端分片约束默认值 `DEFAULT_SPLIT_COUNT` 从 16 调整为 64。
- 将 `MAX_CONNECTION_PER_SERVER` 从 16 调整为 64，确保高分片配置不被后端静默压回 16。

**构建与打包结果**:
- `npm run test`：通过（6/6）。
- `npm run build`：通过。
- `npm run tauri build`：通过。
- 安装包：`src-tauri/target/release/bundle/nsis/tauri-app_0.1.0_x64-setup.exe`。

## 12. 基础设置-启动项完整落地
**文件**: `src/pages/Settings/BasicSettings.tsx`
**改动点**:
- 启动分区补齐并统一展示四项能力：登录时自动启动、开机自启时最小化到托盘、恢复窗口位置大小、恢复未完成任务。
- 新增与系统自启动状态的双向同步：切换“登录时自动启动”后调用系统能力启用/关闭自启动。
- 自启动配置失败时写入开发者日志并给出前台提示，避免静默失败。

**文件**: `src/services/app/appRuntime.ts`
**改动点**:
- 新增 `appGetAutostartEnabled` 与 `appSetAutostartEnabled`，统一封装自启动插件调用。

**文件**: `src-tauri/src/lib.rs`、`src-tauri/Cargo.toml`、`src-tauri/capabilities/default.json`
**改动点**:
- 接入 `tauri-plugin-autostart` 后端插件，并注册启动参数 `--autostart` 以识别开机自启动来源。
- 增加 `autostart:default` 权限与 Rust 依赖，确保前端可安全调用插件能力。

**文件**: `src/App.tsx`、`src/services/app/windowState.ts`、`src/utils/windowBehavior.ts`
**改动点**:
- 启动时根据设置恢复窗口大小与位置。
- 监听窗口移动/缩放并持久化窗口状态。
- 启动时根据设置自动恢复未完成任务。

**文件**: `src/utils/windowBehavior.test.ts`
**改动点**:
- 补充恢复窗口与恢复任务的行为测试用例。

**验证结果**:
- `npm run test`：通过（14/14）。
- `npm run build`：通过。
- `cargo check`：通过。

## 13. 启动链路风险修复与策略增强
**文件**: `src/pages/Settings/BasicSettings.tsx`
**改动点**:
- 新增系统自启动状态回读，在设置页打开时以系统真实状态回填“登录时自动启动”。
- 自启动同步逻辑增加就绪门闩，避免初始化阶段误把系统状态覆盖为本地旧值。
- 启动项新增“恢复策略”选择：恢复全部未完成任务、仅恢复暂停任务、仅恢复失败任务。

**文件**: `src/store/settings/types.ts`、`src/store/settings/defaults.ts`、`src/store/settings/migration.ts`
**改动点**:
- 新增 `startupResumeMode` 配置并接入默认值与迁移归一化，保证老配置平滑升级。

**文件**: `src/App.tsx`、`src/utils/startupResume.ts`
**改动点**:
- 启动恢复从“全量 startAll”改为“按策略筛选后逐任务恢复”，避免误恢复不需要的任务状态。

**文件**: `src/services/app/windowState.ts`
**改动点**:
- 窗口状态存储键改为按窗口标签分桶，避免未来多窗口互相覆盖。
- 恢复窗口时加入越界纠正与尺寸钳制，防止多屏切换后窗口落到可视区外。

**文件**: `src/utils/startupResume.test.ts`
**改动点**:
- 新增启动恢复策略单元测试，覆盖三种恢复模式的筛选结果。

**验证结果**:
- `npm run test`：通过（17/17）。
- `npm run build`：通过。
- `cargo check`：通过。

## 14. 启动恢复提速（并行批处理）
**文件**: `src/App.tsx`
**改动点**:
- 启动恢复由逐任务串行改为分批并行恢复，显著缩短大量任务场景的恢复时间。
- 并发批大小与 `maxConcurrentDownloads` 联动，并在恢复结束后统一刷新任务状态。

**文件**: `src/utils/startupResume.ts`
**改动点**:
- 新增恢复批大小归一化逻辑，限制恢复并发在安全区间内。
- 新增任务批切分函数，为启动恢复并行执行提供稳定分批能力。

**文件**: `src/utils/startupResume.test.ts`
**改动点**:
- 新增并发批大小归一化测试与分批切分测试，覆盖提速逻辑边界。

**验证结果**:
- `npm run test`：通过（19/19）。
- `npm run build`：通过。
- `cargo check`：通过。

## 15. 已完成任务按钮与移除任务弹窗增强
**文件**: `src/components/task/TaskList.tsx`
**改动点**:
- 已完成任务新增 `打开文件 / 重新下载 / 移除任务 / 在文件夹中显示 / 复制链接 / 任务详情` 按钮。
- 下载中失败任务的恢复入口沿用同一按钮语义，标题统一为“恢复下载”。
- 任务列表内的打开文件、打开目录、复制链接逻辑抽成统一动作，避免页面间重复实现。

**文件**: `src/components/task/TaskRemoveDialog.tsx`
**改动点**:
- 将移除任务弹窗抽成独立组件，统一下载中与已完成任务的交互样式。
- 弹窗新增 `同时删除文件` 与 `删除已下载的文件` 两个勾选项，覆盖全量清理与失败残留清理两种场景。

**文件**: `src/utils/taskActions.ts`、`src/utils/taskActions.test.ts`
**改动点**:
- 新增任务动作工具函数，集中处理文件路径提取、重试参数构建、移除请求组装。
- 为重新下载、本地种子占位链接拦截、已下载文件筛选补充单元测试。

**文件**: `src/pages/Completed.tsx`、`src/pages/Downloading.tsx`、`src/store/tasks.ts`
**改动点**:
- 已完成页接入重新下载与新移除弹窗。
- 任务 store 新增 `retryTask`，复用原任务的保存目录、连接数、分片数与高级请求头配置。

**文件**: `src/services/download/aria2RpcEngine.ts`、`src-tauri/src/lib.rs`
**改动点**:
- 扩展移除任务命令参数，支持单独传递“已下载文件”路径集合。
- 后端删除已下载文件时额外清理同名 `.aria2` 控制文件，减少恢复时的脏状态残留。

**验证结果**:
- `npm run test`：通过（32/32）。
- `npm run build`：通过。

## 16. 移除任务流程精简、aria2 更新弹窗与后台 Key 同步
**文件**: `src/components/task/TaskRemoveDialog.tsx`、`src/components/task/TaskList.tsx`、`src/utils/taskActions.ts`、`src/utils/taskActions.test.ts`
**改动点**:
- 移除任务弹窗只保留 `删除已下载的文件` 一个选项，去掉冗余的全量删文件选项。
- 下载中任务的移除改为优先调用 `aria2.forceRemove`，不再先暂停再删，交互与用户预期一致。
- 删除请求结构同步收敛为仅传递“已下载文件路径”，减少前后端分支复杂度。

**文件**: `src/services/download/aria2RpcEngine.ts`、`src-tauri/src/lib.rs`
**改动点**:
- 前端移除任务接口只保留 `deleteDownloadedFiles` 与 `downloadedFilePaths`。
- 后端移除任务时优先强制移除任务，再按需清理已下载文件及对应 `.aria2` 控制文件。

**文件**: `src/components/Aria2UpdateProgressModal.tsx`、`src/pages/Settings/BasicSettings.tsx`
**改动点**:
- 新增 aria2 更新进度弹窗，样式沿用现有卡片、描边、阴影与金色主按钮体系。
- 点击“更新并重启 aria2 引擎”后展示下载与重启状态，成功时自动关闭，失败时保留可手动关闭。
- 弹窗允许用户主动关闭，不阻断后台更新流程。

**文件**: `src/services/app/backendApi.ts`
**改动点**:
- 按最新后台文档同步 `APP_KEY` 为 `4399221304e1e057`。

**验证结果**:
- `npm run test`：通过（40/40）。
- `npm run build`：通过。
- `cargo check`：通过。
- `npm run tauri build`：通过。
- 安装包：`src-tauri/target-package/release/bundle/nsis/TinyAii下载器_1.0.0_x64-setup.exe`。

## 16. 公共 BT Tracker 在线源接入
**文件**: `src/pages/Settings/AdvancedSettings.tsx`、`src/utils/trackerSources.ts`
**改动点**:
- Tracker 来源下拉框补充并明确标注 `ngosang/trackerslist` 与 `XIU2/TrackersListCollection` 在线源。
- “预览同步”从“只读本地文件”升级为“本地目录优先，失败后自动回退 GitHub/CDN 在线列表”。
- Tracker 规范化逻辑统一支持换行与逗号两种格式，避免不同项目产出的列表格式不一致。

**文件**: `src/App.tsx`、`src/services/download/aria2RpcEngine.ts`、`src-tauri/src/lib.rs`
**改动点**:
- 应用启动后会将当前 Tracker 列表同步到 aria2 全局 `bt-tracker` 配置。
- 当开启“每天自动更新 Tracker 列表”且来源为在线列表时，会定时拉取远端最新列表并刷新本地配置。
- 新建 BT 任务时会把当前 Tracker 列表一并写入任务参数，避免引擎尚未同步时出现首个任务漏带 Tracker。

**文件**: `src\utils\trackerSources.test.ts`
**改动点**:
- 新增 Tracker 来源工具测试，覆盖格式归一化、aria2 参数转换与在线源回退映射。

**验证结果**:
- `npm run test`：通过（36/36）。
- `npm run build`：通过。
- `cargo check`：通过。
- `cargo check --target-dir target-check`：通过。
- `npm run tauri build`：通过。
- 安装包产物：`src-tauri/target-package/release/bundle/nsis/TinyAii下载器_1.0.0_x64-setup.exe`。

## 17. 新建任务-种子页样式对齐与重新打包
**文件**: `src/components/task/NewTaskModal.tsx`
**改动点**:
- 种子任务页改为与参考图一致的暖色卡片结构，上传区、已选种子条与文件表格统一收拢到同一容器内。
- 已选种子新增 `Torrent` 标签与单条移除入口，支持快速清理误选文件。
- 文件列表改为 `勾选列 / 序号 / 文件名 / 大小` 的表格样式，视觉更接近目标稿。
- 分片数控件改为居中的数字输入加左右按钮，重命名与存储路径的排版同步对齐。

**验证结果**:
- `npm run test`：通过（36/36）。
- `npm run build`：通过。
- `cargo check`：通过。
- `npm run tauri build`：通过。
- 安装包产物：`src-tauri/target-package/release/bundle/nsis/TinyAii下载器_1.0.0_x64-setup.exe`。

## 18. 本地扩展压缩包导入 UTF-8 兼容修复
**文件**: `src/pages/Plugins/PluginRuntimePage.tsx`、`src/services/plugin/pluginRpcEngine.ts`
**改动点**:
- 插件运行页不再把压缩包路径直接当作纯文本文件读取，改为调用专用运行时脚本读取接口。
- 前端新增 `pluginReadRuntimeScript`，让插件包解析逻辑集中在后端处理，避免 UI 层误读二进制内容。

**文件**: `src-tauri/src/lib.rs`、`src-tauri/Cargo.toml`
**改动点**:
- 新增 `plugin_read_runtime_script` 命令，按插件文件类型分别处理 `.js/.mjs/.cjs`、`.zip`、`.tar`、`.tgz/.gz`。
- 压缩包读取时只筛选 `.js/.mjs/.cjs` 脚本入口，不再把图片、图标等二进制文件按 UTF-8 文本读取。
- 对压缩包内脚本增加入口优先级选择与更明确的错误提示，缺少脚本或脚本编码异常时可直接定位问题。
- 当前仍不支持直接运行 `.7z` 内脚本，统一给出“先解压再导入脚本文件”的提示，避免继续报底层 UTF-8 异常。

**验证结果**:
- `npm run build`：通过。
- `npm run test`：通过（40/40）。
- `cargo check --target-dir target-check`：通过。

## 18. 种子大小与追踪器详情修复
**文件**: `src/components/task/NewTaskModal.tsx`、`src/utils/torrentMeta.ts`
**改动点**:
- 新建任务中的种子大小不再显示 `.torrent` 文件本身大小，改为解析种子元数据后展示实际下载内容总大小。
- 新增轻量 bencode 解析工具，支持单文件与多文件种子总大小计算。
- 种子文件去重键改为基于内容特征生成，避免总大小变化后误判为不同文件。

**文件**: `src-tauri/src/lib.rs`
**改动点**:
- `Aria2BitTorrent` 反序列化增加 `camelCase` 兼容，确保 `announceList` 能正确映射到后端结构。
- 任务详情中的追踪器页可正常读取并展示种子里的 tracker 列表。

**文件**: `src/utils/torrentMeta.test.ts`
**改动点**:
- 补充单文件、多文件、非法种子三类解析测试，覆盖总大小计算边界。

**验证结果**:
- `npm run test`：通过（39/39）。
- `npm run build`：通过。
- `cargo check`：通过。

## 19. BT 做种状态显示优化
**文件**: `src/components/task/TaskList.tsx`
**改动点**:
- 对种子任务增加“做种中”判定：当任务为 BT、仍处于活动态且下载进度达到 100% 时，列表状态文案从“下载中”改为“做种中”。
- “做种中”状态标签改为绿色显示，便于和普通下载态区分。
- 做种阶段的暂停按钮提示文案改为“暂停做种”，右键菜单中的暂停项同步调整。

**文件**: `src/components/task/TaskDetailsModal.tsx`
**改动点**:
- 任务详情中的状态标签同步支持“做种中”与绿色样式，避免列表与详情状态不一致。

**验证结果**:
- `npm run test`：通过（39/39）。
- `npm run build`：通过。
- `cargo check`：通过。

## 20. BT 做种状态打通、上传速度展示与筛选增强
**文件**: `src-tauri/src/lib.rs`、`src/types/task.ts`、`src/services/download/aria2RpcEngine.ts`
**改动点**:
- 后端任务状态映射新增显式 `seeding` 状态，BT 任务在下载完成但仍处于 aria2 活动态时，不再伪装成 `downloading`。
- 任务 DTO 与前端类型补充 `uploadSpeedBytes` 字段，前后端统一透传上传速度数据。
- 前端任务模型正式支持 `seeding` 状态，避免继续依赖“下载进度 100%”的推断逻辑。

**文件**: `src/pages/Downloading.tsx`、`src/components/task/TaskList.tsx`、`src/components/task/TaskDetailsModal.tsx`
**改动点**:
- 下载中页面新增状态筛选，下拉项支持 `全部任务 / 下载中 / 做种中 / 已暂停 / 失败 / 已停止`。
- 任务列表中的做种任务展示实时上传速度，样式与普通下载速度区分显示。
- 右下角全局速度悬浮窗改为按任务状态汇总下载速度或上传速度，做种任务也能反映真实吞吐。
- 详情页活动分区在做种场景下可直接读取任务级上传速度，避免详情轮询未返回时出现空白。

**文件**: `src/utils/taskActions.ts`、`src/utils/taskActions.test.ts`、`src/utils/startupResume.test.ts`、`src/services/download/mockAria2Engine.ts`
**改动点**:
- 删除任务时，做种任务会被视为“已完整下载”，`删除已下载文件` 选项可正确覆盖 BT 已落盘文件。
- 补充做种文件路径与新增字段测试，确保类型扩展后测试数据完整。
- 模拟引擎同步支持做种状态与上传速度，便于本地无后端时保持交互一致。

**验证结果**:
- `npm run test`：通过（40/40）。
- `npm run build`：通过。
- `cargo check`：通过。

## 21. 做种统计、默认下载路径与前端分包优化
**文件**: `src/components/task/TaskDetailsModal.tsx`、`src/store/tasks.ts`、`src/types/task.ts`、`src/utils/format.ts`
**改动点**:
- BT 任务活动分区新增 `上传总量` 与 `做种时长` 两项指标，做种状态下可直接判断回传贡献。
- 任务状态模型新增 `seedingStartedAt`，在任务首次进入 `seeding` 状态时记录本地时间，用于前端持续计算做种时长。
- 新增时长格式化工具，统一输出秒、分、小时、天的可读文案。

**文件**: `src/App.tsx`
**改动点**:
- 应用启动时若默认下载路径为空，会自动读取程序安装目录并写入基础设置。
- 路由页、设置页、插件页与全局弹窗改为懒加载，减少首屏主包体积。
- 为懒加载页面补充统一加载态，避免切页时出现空白。

**文件**: `vite.config.ts`
**改动点**:
- 构建配置新增 `manualChunks`，将 `react`、`react-router`、`@tauri-apps`、图标库等依赖拆分为独立 chunk。
- 构建结果不再出现超大 chunk 告警，后续页面继续扩展时更容易控制首屏加载成本。

**验证结果**:
- `npm run test`：通过（40/40）。
- `npm run build`：通过。
- 构建产物示例：`react-vendor` 约 201.59 kB、`AdvancedSettings` 约 67.69 kB、主入口 `index` 约 46.35 kB。

## 22. 下载中/已完成空状态改为金色波浪风格并重新打包
**文件**: `src/components/common/EmptyState.tsx`
**改动点**:
- 将原来的方框下载图标替换为三层金色波浪 SVG，更接近“海浪”视觉意向。
- 中间主标题与副标题统一复用关于页底部同款 `text-gold-wave` 动效，形成一致的品牌语言。
- 空状态整体透明度与阴影重新调整，保持存在感但不过度抢占页面主体。

**文件**: `src/pages/Downloading.tsx`、`src/pages/Completed.tsx`
**改动点**:
- 下载中空状态文案调整为“静待下载浪潮涌来”。
- 已完成空状态文案调整为“等待下一次满载而归”。

**验证结果**:
- `npm run build`：通过。
- `npm run tauri build`：通过。
- 安装包产物：`src-tauri/target-package/release/bundle/nsis/TinyAii下载器_1.0.0_x64-setup.exe`。

## 23. 连接上限显示逻辑澄清
**文件**: `src/pages/Settings/BasicSettings.tsx`
**改动点**:
- 在基础设置“当前策略”和“单服务器最大连接数”说明中明确：单任务实际有效连接上限取 `分片数` 与 `单服务器最大连接数` 的较小值。
- 避免把“单服务器连接上限 256”误解为“单任务一定会跑满 256 条活动连接”。

**文件**: `src/components/task/TaskDetailsModal.tsx`
**改动点**:
- 下载任务详情中新增“有效连接上限（任务设置）”展示，按 `min(分片数, 单服务器连接上限)` 计算。
- 保留“单服务器连接上限（任务设置）”原始值，方便区分“配置值”和“当前任务实际可达到的上限”。

**验证结果**:
- `npm run test`：通过。
- `npm run build`：通过。

## 24. 分片数与连接数上限提升到 512
**文件**: `src-tauri/src/lib.rs`
**改动点**:
- 后端任务约束中将 `MAX_SPLIT_COUNT` 从 128 提升到 512。
- 后端任务约束中将 `MAX_CONNECTION_PER_SERVER` 从 256 提升到 512。
- 前端读取到的 aria2 任务参数范围会同步扩展到 1-512。

**文件**: `src/store/settings/migration.ts`
**改动点**:
- 设置迁移逻辑同步放宽到 512，避免旧配置在升级后仍被历史上限截断。
- 保证已有用户把值保存到 300、400 这类区间时，升级后不会再次被压回旧上限。

**文件**: `src/pages/Settings/BasicSettings.tsx`、`src/components/task/NewTaskModal.tsx`
**改动点**:
- 页面本地兜底上限同步调整到 512，避免约束接口尚未返回时先显示旧上限。
- 这样即使初始化阶段发生延迟，界面也不会短暂回退到 64/128 的旧范围。

**文件**: `src/store/settings/store.test.ts`
**改动点**:
- 更新迁移测试断言，验证旧数据会被正确钳制到新的 512 上限。

**验证结果**:
- `npm run test`：通过。
- `npm run build`：通过。

## 25. 纯客户端加密插件包落地与重新打包
**文件**: `src-tauri/src/local_plugin_crypto.rs`、`src-tauri/src/lib.rs`、`src-tauri/Cargo.toml`
**改动点**:
- 新增 `.tinyplugin` 纯客户端加密插件格式，采用应用内置密钥派生的 AES-256-GCM 解密流程，无需服务器参与。
- 本地插件预检、导入、运行时脚本读取链路全部接入 `.tinyplugin`，加密包可直接导入并执行。
- 加密包清单改为内嵌存储，导入时自动解出并写入本地缓存清单，普通 `.js/.zip` 插件仍保持原有兼容逻辑。

**文件**: `src/pages/Plugins/ImportPlugins.tsx`
**改动点**:
- 导入文件选择器新增 `.tinyplugin` 扩展名。
- 导入说明补充“加密包内嵌清单”，降低使用门槛。

**发布产物**: `C:\Users\XIAOJIE\Desktop\xiazai\gopeed-extension-quark-main\release`
**改动点**:
- 清理旧发布目录，重建为 `源代码`、`混淆版` 两套产物结构。
- 每套产物均包含 `tinyaii-quark-plugin.js`、`tinyaii-quark-plugin.plugin.json`、`tinyaii-quark-plugin.tinyplugin`。
- `混淆版` 中的 `.tinyplugin` 使用混淆后的脚本重新加密，避免“包内明文源码”泄露。

**验证结果**:
- `npm run test`：通过（40/40）。
- `cargo check --target-dir target-check`：通过。
- `npm run build`：通过。
- `npm run tauri build`：通过。
- 安装包产物：`src-tauri/target/release/bundle/nsis/TinyAii下载器_1.0.0_x64-setup.exe`。

## 26. 隐藏夸克插件仓库地址并重新打包插件
**文件**: `src/pages/Plugins/PluginDetail.tsx`
**改动点**:
- 扩展详情页中的“仓库地址”改为仅在插件实际声明 `repository` 时显示。
- 当插件清单未提供仓库地址时，页面不再出现“仓库地址 / 未声明”这一整块信息。

**文件**: `gopeed-extension-quark-main/tinyaii-quark-plugin.plugin.json`
**改动点**:
- 移除夸克插件清单中的 `homepage` 与 `repository` 字段。
- 重新生成 `release/源代码` 与 `release/混淆版` 下的 `.plugin.json` 与 `.tinyplugin`，确保发布包内不再携带仓库地址。

**验证结果**:
- `release/源代码/tinyaii-quark-plugin.plugin.json`：已确认不包含仓库地址。
- `release/混淆版/tinyaii-quark-plugin.plugin.json`：已确认不包含仓库地址。

## 27. 新增独立 UC 网盘插件并与夸克插件分目录打包
**文件**: `gopeed-extension-uc-main/gopeed-extension-uc-main/tinyaii-uc-plugin.js`
**改动点**:
- 新增独立的 UC 网盘插件源码，沿用夸克插件的运行时结构与界面布局。
- 支持打开 UC 登录页、同步 `uc.cn` Cookie、读取账号信息、浏览个人网盘根目录与子目录。
- 支持 UC 分享链接直链解析，按“分享令牌 → 文件列表 → 下载链接”链路递归解析文件夹并推送下载任务。
- 新增分享直链缓存、目录缓存与运行时能力校验，减少重复解析请求。

**文件**: `gopeed-extension-uc-main/gopeed-extension-uc-main/tinyaii-uc-plugin.plugin.json`
**改动点**:
- 新增 UC 插件清单，独立声明插件 ID、菜单路由与显示名称。

**发布产物**:
- `C:\Users\XIAOJIE\Desktop\xiazai\gopeed-extension-quark-main\release`
- `C:\Users\XIAOJIE\Desktop\xiazai\gopeed-extension-uc-main\release`

**改动点**:
- 夸克与 UC 插件分别保留独立源码目录与独立 `release` 目录，互不覆盖。
- 两个插件的 `release` 下均重建为 `源代码`、`混淆版` 两套产物。
- 每套产物均包含 `.js`、`.plugin.json`、`.tinyplugin` 三类文件，满足源码版与混淆版分发。

**验证结果**:
- `node --check`：已通过夸克源码版、夸克混淆版、UC 源码版、UC 混淆版共 4 个脚本的语法校验。
- `.tinyplugin`：已使用与应用一致的 AES-256-GCM 规则重新打包，并在打包时执行解包比对校验。
- `tinyaii-uc-plugin.js`：编辑器诊断结果为空，未发现新的语法问题。

## 28. 对齐 UC 插件与夸克插件界面风格
**文件**: `gopeed-extension-uc-main/gopeed-extension-uc-main/tinyaii-uc-plugin.js`
**改动点**:
- 将 UC 插件主界面改为与夸克插件一致的左侧分栏布局，拆分为“账号与同步 / 分享解析 / 网盘文件”三个区域。
- 将原来堆叠在同一界面的卡片式内容改为分面板展示，减少信息拥挤，操作路径更接近夸克插件。
- 解析结果、网盘文件、日志区统一改为表格与列表结合的紧凑样式，按钮尺寸、边框与间距与夸克插件保持一致。

**文件**: `src/pages/Plugins/PluginRuntimePage.tsx`
**改动点**:
- 移除运行时页面底部的“打开插件包”按钮，仅保留必要的插件主页入口与基础信息。
- 保持插件运行区更纯粹，避免用户在使用插件时看到与当前操作无关的包路径入口。

**验证结果**:
- `tinyaii-uc-plugin.js`：编辑器诊断结果为空。
- `PluginRuntimePage.tsx`：编辑器诊断结果为空。

## 29. 新增独立 123 网盘插件并完成双版本打包
**文件**: `gopeed-extension-123-main/gopeed-extension-123-main/tinyaii-123-plugin.js`
**改动点**:
- 新增 123 网盘运行时插件，沿用夸克 / UC 的左侧分栏布局，拆分为“账号与同步 / 分享解析 / 分享文件”三块区域。
- 接入 123 网盘的分享目录读取接口、Android 下载直链接口和 Token 登录态管理，支持账号密码登录或手动粘贴 Token。
- 增加分享目录递归缓存、直链缓存、解析日志和单文件 / 全量推送下载任务能力，便于反复解析时减少重复请求。
- 修复请求头中 `App-Version` 字段的对象字面量语法问题，确保源码与混淆版都可以通过语法校验和混淆打包。

**文件**: `gopeed-extension-123-main/gopeed-extension-123-main/tinyaii-123-plugin.plugin.json`
**改动点**:
- 新增 123 插件清单，独立声明插件 ID、菜单路由、显示名称与分组信息。

**发布产物**:
- `C:\Users\XIAOJIE\Desktop\xiazai\gopeed-extension-123-main\release\源代码`
- `C:\Users\XIAOJIE\Desktop\xiazai\gopeed-extension-123-main\release\混淆版`

**改动点**:
- 重新生成 123 插件的 `源代码` / `混淆版` 两套发布目录，每套均包含 `.js`、`.plugin.json`、`.tinyplugin` 三类文件。
- `.tinyplugin` 继续使用应用内一致的 AES-256-GCM 规则进行本地加密，并在打包时执行解包比对，确保包内脚本与清单可被正确恢复。

**验证结果**:
- `node --check`：已通过 123 插件源码版与混淆版脚本语法校验。
- `manifest ok`：已确认 `tinyaii-123-plugin.plugin.json` 可正常解析。
- `.tinyplugin`：源码版、混淆版均已重新生成并通过打包后解密比对校验。

## 30. 发布前默认值与反馈入口调整
**文件**: `src/store/settings/defaults.ts`
**改动点**:
- 保持新用户的基础下载默认值为“分片数 128、连接数 64”。
- 将开发者日志相关默认值改为关闭，首次安装时不再默认展示开发者日志入口，也不默认记录开发者日志。

**文件**: `src/components/task/NewTaskModal.tsx`
**改动点**:
- 调整新建任务弹窗的默认分片数初始化逻辑，弹窗每次打开都会重新读取基础设置中的默认分片数。
- 当用户在基础设置中将默认分片数改为 512 后，新建任务会同步默认使用 512，而不是继续沿用上一次弹窗残留值。

**文件**: `src/components/AboutModal.tsx`
**改动点**:
- 将“更新日志”和“帮助与支持”两个入口统一改为跳转到 TinyAii 官方反馈 QQ 群。
- 发布前统一收口反馈入口，便于用户在遇到解析异常、安装问题时直接进入官方群反馈。

**验证结果**:
- `npm run test`：通过。
- `npm run build`：通过。
- `cargo check --target-dir target-check`：通过。
- `npm run tauri build`：通过，并重新生成 NSIS 安装包。

## 32. 扩展中心新增插件制作教程与 JSON 导出
**文件**: `src/pages/Plugins/PluginsSidebar.tsx`、`src/App.tsx`
**改动点**:
- 在扩展中心侧边栏新增“插件教程”菜单项，作为统一的插件开发入口。
- 新增路由 `/plugins/tutorial`，与已安装、发现扩展、导入扩展保持同级导航结构。

**文件**: `src/pages/Plugins/PluginTutorial.tsx`
**改动点**:
- 新增插件制作教程页，整合清单结构、运行时挂载、请求封装、下载任务推送、调试与打包发布说明。
- 教程页内置示例 `plugin.json`、运行时挂载代码、请求封装示例、`createDownloadTask()` 推送示例。
- 新增“导出 JSON 教程”按钮，支持一键导出结构化教程文件，便于外部分发或二次加工。
- 明确说明当前扩展市场未开放，插件正式分发仍以本地导入、群文件或私有渠道为主。

**文件**: `src/pages/Plugins/PluginTutorial.tsx`、`src/services/download/aria2RpcEngine.ts`、`src-tauri/src/lib.rs`
**改动点**:
- 修复教程页“导出 JSON 教程”在 Tauri 桌面端点击无反应的问题。
- 导出流程改为“选择保存路径 + 后端实际写入文件”，不再依赖浏览器 `Blob` 下载行为。
- 导出后在页面内显示成功、取消或失败提示，便于用户确认结果。

**验证结果**:
- `npm run build`：通过。
- `cargo check --target-dir target-check`：通过。
- `npm run tauri build`：通过，并重新生成 NSIS 安装包。

## 31. 发布前修正反馈入口与清空扩展市场占位数据
**文件**: `src/components/AboutModal.tsx`
**改动点**:
- 将关于弹窗中的链接打开方式从文件路径打开改为网页链接打开，确保点击后会正确跳转到 `https://qm.qq.com/q/4LdjmUG5Ko`。
- 将按钮文案由“更新日志 / 帮助与支持”调整为“官方Q群 / 点我反馈”，与当前发布阶段的实际用途一致。

**文件**: `src-tauri/src/lib.rs`
**改动点**:
- 移除发现扩展接口中的内置演示数据，扩展市场列表改为空数组，避免发布后继续展示假数据。

**文件**: `src/pages/Plugins/DiscoverPlugins.tsx`
**改动点**:
- 为发现扩展页补充空状态文案，在市场未开放时提示用户通过本地导入安装扩展。

**验证结果**:
- `npm run test`：通过。
- `npm run build`：通过。
- `cargo check --target-dir target-check`：通过。
- `npm run tauri build`：通过，并重新生成 NSIS 安装包。
