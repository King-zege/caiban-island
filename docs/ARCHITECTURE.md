# 采办岛当前技术架构

本文件只记录当前稳定结构。具体 schema、IPC 参数和命令列表以 `src/shared/`、`src/main/db.ts`、`src/main/ipc.ts` 与 `src/shared/appCommandContracts.ts` 为准，不在文档中复制整份源码。

## 1. 技术栈

| 领域 | 当前实现 |
| --- | --- |
| 桌面运行时 | Electron 43、TypeScript strict、electron-vite |
| UI / 状态 | React 19、Zustand、lucide-react |
| 数据 | Electron `node:sqlite`，WAL + foreign keys，main 独占 |
| Agent | `@earendil-works/pi-agent-core` / `pi-ai` 0.81.1，DeepSeek 官方 provider |
| Windows 集成 | koffi Acrylic、Toast、托盘、单实例、全屏检测 |
| 内容 / 同步 | react-markdown、JSZip、PDF.js；飞书 bitable v1；CSV/Markdown 导出 |
| 测试 / 打包 | Vitest、Testing Library、axe、Electron 截图/基准；electron-builder portable |

Pi 两个包精确锁定为 0.81.1，MIT，要求 Node ≥22.19。不得引入 `pi-coding-agent`、TUI、通用文件/终端工具或 Pi 会话目录。Pi 为纯 ESM，构建必须保留当前内联与 lazy-provider 处理，避免生成 CJS `require`。

## 2. 进程分层

- **main**：窗口、SQLite、AppService/AppCommand、提醒、归档、Agent、授权文件、DeepSeek、safeStorage、本地命令端点和系统集成。
- **preload**：只暴露白名单 IPC，无业务规则。
- **renderer**：React 组件与 Zustand store；不访问 Node、数据库、文件或网络。
- **shared**：类型、schema、排序、时间、状态机与设计 token；不依赖 Electron/renderer。

正式写入路径固定为：

`renderer / Agent / caiban-cli → IPC 或回环端点 → AppCommandService → AppService → 领域服务 → SQLite/文件/提醒`

任何入口都不得直接调用数据库写入绕过 AppCommand/AppService。事务提交后才发送变更通知。

## 3. 主要模块

| 模块 | 职责 |
| --- | --- |
| `IslandWindowController` | L1/L2/L3 状态、单次 resize、点击穿透、backdrop、全屏退让 |
| `AppService` | 正式业务事务、提醒一致性、变更通知 |
| `AppCommandService` | 统一命令 schema、风险、预期旧值、摘要和撤销元数据 |
| `AgentService` | 唯一 run、会话、事件序号、快照、工具与终态 |
| `PiAgentAdapter` | Pi/DeepSeek 流式协议与工具循环；不含业务写入 |
| `AgentPermissionService` | 三档权限、审批等待、Bypass 和授权目录元数据 |
| `AuthorizedFileService` | 授权根内文件操作与 realpath/逃逸防护 |
| `KnowledgeService` | 单一主工作目录、增量扫描、Office/PDF 提取、FTS5、来源定位与不可信正文脱敏 |
| `AutomationService` | 结构化计划、持久队列/防重/审批、DailyBriefingDocument、模型降级和 PDF 生成编排 |
| `AgentSessionService` / `MemoryService` | 可见会话、FTS5 召回、确认记忆与提案 |
| `ReminderService` | 项目、节点、杂事提醒的派生调度与原子领取 |
| `ContractService` | 合同台账、履约动作、付款—开票关联、资料、备注与生命周期状态机 |
| `ArchiveService` / `FeishuService` | 本地快照与恢复；单向飞书 upsert/导出 |

## 4. Agent 与权限流

`AgentWorkspace → preload IPC → AgentService → PiAgentAdapter → beforeToolCall → AppCommand/授权文件工具`

- L2/L3 渲染同一 Agent store 和组件；组件卸载不取消 run。
- main 为事件分配单调 sequence，并保存 phase、partialText、activeTool、pendingApproval 与脱敏 error 快照。assistant 消息先落库再广播完成。
- `beforeToolCall` 根据 AppCommand 风险与权限模式执行、等待批准或阻断。未知工具 fail-closed 为高风险。
- 只读工具包括项目、合同、归档、会话搜索、授权目录读取，以及工作目录树/检索/来源片段/派生索引刷新；正式数据工具统一调用 AppCommand。
- DeepSeek function parameters 必须声明顶层 `type: object`；`execute_app_command` 以 `type: object` 与判别联合 `anyOf` 组合，既满足 provider 约束又保留逐命令校验。TypeBox 可空 UTC 联合以 `null` 分支优先，防止 `Value.Convert` 把 `null` 转为空字符串。
- 授权文件只接受目录 ID 与相对路径；main 拒绝设备/UNC、`..`、符号链接/联接逃逸和未授权目标。
- 无任意 shell、任意 URL 或额外网络工具。Qoder MCP、旧 LLM 和 stdio 服务已删除；遗留 pending 草稿在 migration v8 转换为通用 AgentProposal。

## 5. 数据与迁移

数据目录为 `%APPDATA%\caiban-island\`。核心实体：

- `tasks`：采购项目/杂事、正式全名、卡片简称、流程模板、状态、时区、deadline/精确提醒和审计时间。
- `nodes`、`links`、`notes`、`change_events`；节点保存阶段 key 和模板/Agent/自定义来源。
- `contracts`、`contract_actions`、`contract_action_reminders`、`contract_links`、`contract_notes`、`contract_change_events`。
- `reminders`、`node_reminders`、`misc_reminders`。
- `agent_proposals`：持久化待批准命令或命令批次。
- `agent_sessions`、`agent_messages`、`agent_messages_fts`。
- `memories`、`memory_proposals`、`settings`。
- `knowledge_scans`、`knowledge_sources`、`knowledge_chunks`/FTS5 与 `workspace_project_bindings`；数据库只保存相对路径和本机派生正文，不记录工作目录绝对路径。
- `agent_automations`、`automation_runs`；计划触发时间唯一，运行状态跨重启保持 queued/running/waiting_approval/succeeded/failed/skipped。

当前 migration 为 v1–v12：v8 增加双名称、采购判别类型、模板字段与通用提案；v9 增加采购节点来源/采购方式及完整合同域；v10 增加工作目录扫描、来源、分块 FTS5 与项目绑定；v11 增加 Agent 自动化与持久运行；v12 将遗留 pending 草稿转换为通用提案并删除旧草稿表。新增 schema 必须追加版本迁移并测试升级、失败回滚和幂等，禁止启动时执行未版本化 DDL。

时间以 ISO8601 UTC 保存，按 `tz_id` 显示；ID 为 GUID；排序必须包含稳定 tie-breaker。外键级联处理依附实体，跨服务副作用由 AppService 事务编排。

## 6. IPC 与外部接口

IPC 分组而非逐项复制：

- `procurements/tasks/nodes/links/notes/reminders/misc/archive`：采购与杂事读写，写入经 AppCommand。
- `contracts/contractActions/contractLinks/contractNotes`：合同台账与履约读写，写入经 AppCommand。
- `agent/deepseek/memory/proposals`：会话、run、权限、配置、记忆和通用提案。
- `knowledge`：主目录状态/选择、相对目录树、检索、来源片段、刷新与取消；选择之外不向 renderer 暴露绝对路径。
- `automations`：列表/运行、总开关和审批；创建、更新、单项启停和删除仍经 AppCommand。
- `window/ui/island/reminder`：窗口状态、过渡、偏好、交互与通知导航。
- `settings/feishu/system`：设置、单向同步/导出和安全打开外部目标。

所有业务调用返回 `{ ok, data }` 或 `{ ok: false, error }`；入参与出参在 shared 定义。`agent:event` 只传用户可见文本和脱敏状态，不传 reasoning 或工具原始正文。

本地命令服务器使用 Node `http`，绑定 `127.0.0.1` 随机端口，校验 safeStorage 随机令牌、JSON Content-Type、128KB 上限和完整 AppCommand schema。`scripts/caiban-cli.mjs` 只提交一个注册命令，不接受 shell 或任意网络转发。

## 7. 提醒、归档与同步

- `tasks.deadline_utc`、`nodes.start_utc`、`tasks.remind_at_utc` 与 `contract_actions.due_at_utc` 是用户计划；提醒表是可重建派生状态。
- 调度按记录主键原子领取，修改时间重置 fired，其他字段不重复提醒；归档/删除/完成/取消移除资格，恢复只同步未来时间。
- 启动和 `powerMonitor.resume` 合并漏发摘要；Toast 点击以只读事件定位，不携带备注或路径。
- 归档写 SQLite 与 `archive/YYYY-MM/.../task.md|task.json`；同名不覆盖，恢复校验 JSON 后重建活跃任务。
- 飞书只 upsert 活跃采购项目，合同、杂事与知识数据不外发；PersonalBaseToken 经 safeStorage 保存，同步失败不影响本地事务，CSV/Markdown 为无凭据兜底。

## 8. Windows 窗口与渲染

- 同一透明、无边框、置顶、跳过任务栏的 BrowserWindow 在 L1/L2/L3 之间变化。
- 过渡状态为 `preparing → animating → settling`；每次切换最多一次 `setBounds`。composited 200ms、software 120ms、direct 单帧。
- 高对比度、减少动画或 GPU 异常强制 direct；Acrylic 失败回退纯色。禁止强制绕过 GPU blocklist。
- L1 使用屏幕坐标轮询热区与 `setIgnoreMouseEvents(..., { forward: true })`，不得用透明窗口吞点击。
- 所有尺寸为逻辑像素并按 per-monitor DPI 换算；真正全屏应用出现时退让。

## 9. 安全、测试与分发

- API Key、PersonalBaseToken、本地命令令牌只以 safeStorage 密文落盘；日志、SQLite 明文、快照、备份、导出和测试夹具不得包含它们。
- Markdown 不启用 raw HTML；外链/文件由 main 验证并在 renderer 展示真实目标后确认。
- 测试变量 `CAIBAN_TEST_*` 只在未打包且数据目录位于系统临时目录时生效；生产包拒绝覆盖用户数据目录。
- electron-builder 生成 portable EXE、win-unpacked 和本地验收 zip；GitHub Release 只提供推荐 EXE。无代码签名，SmartScreen 提示属预期。
- 许可证随 `resources/THIRD_PARTY_NOTICES.md` 分发；新增依赖必须记录用途、许可证和维护状态。

## 10. 目录索引

```text
src/main       主进程、服务、数据库、Agent、Windows 集成
src/preload    contextBridge 白名单
src/renderer   React 组件、panels、Zustand state、样式
src/shared     类型、schema、业务纯函数、设计 token
tests          单元、集成、renderer 与 P21 隔离验收
scripts        CLI、视觉夹具、截图和性能基准
docs           当前规范与交接
```
