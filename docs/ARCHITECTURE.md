# 采办岛 v1 技术架构

## 1. 架构目标

架构优先保证四件事：原生窗口与动画体验（透明、置顶、磨砂、60fps）、本地数据可靠性（SQLite + 快照 + 自动备份）、Agent 权限可审计（Pi、Qoder MCP 与旧内置 API 都不能直接写正式数据）、核心业务可在不启动 UI 的情况下测试。

## 2. 技术栈决策

| 领域 | 决策 | 说明 |
| --- | --- | --- |
| 运行时 | Electron（实施时锁定最新稳定版） | Win10/Win11 透明置顶窗口方案成熟 |
| 语言 | TypeScript（strict） | 主进程/渲染层同语言 |
| UI | React 19 + Vite（electron-vite） | 组件化、HMR 快 |
| 状态 | Zustand | 轻量、配合 React 18/19 |
| 图标 | lucide-react | 用户锁定的单一线性图标家族；全局统一 1.75px stroke |
| 动画 | 单次原生 resize + CSS compositor 视觉壳 | main 协调 preparing/animating/settling；renderer 只动画 transform/opacity/border-radius；软件渲染自动简化或直切 |
| 数据库 | Node `node:sqlite`（DatabaseSync） | Electron 内置、同步 API、WAL；主进程独占，无原生扩展重编译 |
| 磨砂 | koffi 调用 SetWindowCompositionAttribute | Win10 1803+/Win11 Acrylic；失败回退纯色 |
| MCP | @modelcontextprotocol/sdk | SSE server + STDIO shim |
| 内置 LLM | Node fetch（OpenAI-compatible） | function call 结构化输出 |
| 原生 Agent | Pi Agent Core 0.81.1 + Pi AI 0.81.1 | main 中运行；DeepSeek 官方 provider；只装最小两个 Pi 包 |
| 飞书同步 | Node fetch（飞书多维表格 bitable v1 Open API）+ PersonalBaseToken | 个人令牌免管理员审批；无 CLI 依赖 |
| Markdown | react-markdown（不启用 rehype-raw） | 禁止原始 HTML、脚本与远程嵌入 |
| 打包 | electron-builder（portable EXE + 验收用 zip） | 免证书、免安装；GitHub Release 仅发布单一推荐 EXE |
| 测试 | Vitest + Testing Library + user-event + jsdom + axe + Electron 视觉回归 | 单元、交互、无障碍与确定性截图，见 TEST_PLAN.md |

### 2.1 P9 新增依赖审查（2026-08-16）

| 依赖 | 版本 | 许可证 | 维护状态与用途 |
| --- | --- | --- | --- |
| lucide-react | 1.31.0 | ISC | 2026-08-09 仍有发布；renderer 唯一功能图标家族 |
| @testing-library/react | 16.3.2 | MIT | React 19 组件语义与交互测试 |
| @testing-library/user-event | 14.6.4 | MIT | 键盘、指针与焦点行为测试 |
| jsdom | 30.0.1 | MIT | Vitest renderer DOM 环境 |
| axe-core | 4.13.0 | MPL-2.0 | serious/critical 无障碍问题自动检查 |

上述依赖只用于图标呈现或测试，不跨越 renderer/main 边界；安装时 `npm audit` 为 0 个已知漏洞。

### 2.2 P13 Pi 上游与依赖准入（2026-08-23）

P14 已引入官方 Pi `v0.81.1`（提交 `20be4b18d4c57487f8993d2762bace129f0cf7c6`）中的以下两个 MIT 包，并精确锁定版本：

| 依赖 | 版本 | 许可证 | 用途与边界 |
| --- | --- | --- | --- |
| @earendil-works/pi-agent-core | 0.81.1 | MIT | main 中的模型/工具循环；不得直接依赖 renderer、IPC 或正式数据服务 |
| @earendil-works/pi-ai | 0.81.1 | MIT | DeepSeek provider 与流式协议；仅允许官方 API 端点 |

两个包要求 Node ≥22.19；Electron 43.4.0 内置 Node 24.18.1。未引入 `pi-coding-agent`、TUI、文件/终端工具与 Pi 会话目录。安装使用 `--ignore-scripts`，lockfile 保留 integrity；`@google/genai` / `protobufjs` 仅作为 Pi AI 的传递依赖，安装脚本未执行。`resources/THIRD_PARTY_NOTICES.md` 随包分发；生产依赖审计为 0 个已知漏洞。

P14 Windows x64 打包实测：portable EXE 88,796,920 字节、ZIP 144,258,091 字节；相较 P13 分别增加约 3.54 MB 与 9.64 MB。asar 已核对包含两个 Pi 包、DeepSeek provider 与第三方声明。Pi AI 的其它 provider 文件随其正式 npm 包进入 asar，但应用只注册 DeepSeek provider，相关 API 实现按 Pi lazy loader 在调用时加载。

## 3. 进程分层

- **main（主进程）**：窗口、SQLite、归档、提醒、MCP、Pi Agent/DeepSeek、旧 LLM、safeStorage 与系统集成。`AgentService` 编排 run，`PiAgentAdapter` 只处理 Pi 协议，`AgentSessionService` 只处理可见会话；Pi 不依赖 renderer、IPC 或正式任务服务。
- **preload**：contextBridge 暴露白名单 API，不含业务逻辑。
- **renderer（React UI）**：组件、面板、Zustand 状态；不直接访问 Node/DB/文件/网络，一切经 IPC。
- **shared**：类型、IPC 通道名、设计 token 常量、schema 校验器（main 与测试复用）。

设计 token 以 `src/shared/designTokens.ts` 为唯一来源。renderer 把语义 token 映射为根节点 CSS variables；组件不得维护第二份颜色、圆角或间距常量。

## 4. IPC 通道白名单

| 通道 | 方向 | 说明 |
| --- | --- | --- |
| tasks:list / detail / create / update / complete / cancel / delete | renderer→main | 任务 CRUD 与详情（完成/取消即归档；delete 为确认后的永久删除） |
| nodes:add / update / remove / setStatus / reorder | renderer→main | 节点操作（四态、排序） |
| links:add / remove | renderer→main | 链接管理（URL 仅 http/https） |
| notes:save | renderer→main | 备注保存（每任务一条，Markdown） |
| reminders:list / set | renderer→main | 提醒提前量管理（仅 deadline 任务） |
| drafts:list / get / confirm / discard | renderer→main | AI 草稿审核（P5） |
| archive:list / search / get / restore | renderer→main | 归档查询、恢复（快照导出在主进程完成/取消时执行） |
| settings:getAll / set | renderer→main | 设置（默认提醒、自启、磨砂开关） |
| feishu:sync / feishu:test / feishu:export | renderer→main | 飞书同步、连接测试、CSV/Markdown 导出（P6） |
| mcp:getConfig / resetToken | renderer→main | MCP 配置展示与令牌重置（P5） |
| agent:start / send / cancel | renderer→main | 新建/继续/取消唯一活跃 Pi run（P14） |
| agent:listSessions / getSession / deleteSession / clearSessions / exportSession | renderer→main | 本机会话读取、删除、清空与导出（P14） |
| agent:event | main→renderer | 流式可见文本、脱敏工具状态、消息与 run 状态；不含 reasoning |
| deepseek:status / saveConfig / test | renderer→main | 固定官方 Base URL；模型选择与 safeStorage Key（P14） |
| system:openUrl / openPath / showInFolder | renderer→main | 系统打开动作 |
| window:setLevel / setL2Detail / activate | renderer→main | 请求窗口三级控制、速览加高、焦点激活；层级请求返回 `TransitionRequestResult` |
| window:transitionReady / transitionFinished | renderer→main | renderer 完成目标层准备与 compositor 动画后确认当前 transition id |
| window:transition | main→renderer | 推送 `IslandTransitionState` 阶段、源/目标几何、时长与渲染模式 |
| ui:interacting / island:togglePause / app:quit | renderer→main | 交互态、暂停、退出 |
| ui:getPreferences / ui:preferences | main→renderer | 只读 `UiPreferences`：系统明暗、高对比度、减少动画与实际 backdrop；系统设置变化时推送 |
| debug:sendKey / sendTab（仅 ISLAND_DEBUG） | renderer→main | 自动化验证输入注入 |

所有通道入参与出参类型在 shared 定义；renderer 收到的错误为可操作的中文消息；业务通道统一返回 { ok, data | error }。

## 5. 数据模型与 SQLite

数据目录：%APPDATA%\caiban-island\（island.db、archive\、backups\）。

    CREATE TABLE tasks(
      id TEXT PRIMARY KEY,                 -- GUID
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'task',   -- task | misc
      urgency TEXT NOT NULL DEFAULT 'normal', -- critical | high | normal | low
      deadline_utc TEXT,                   -- ISO8601 UTC，可空
      tz_id TEXT NOT NULL,                 -- IANA 时区 ID
      status TEXT NOT NULL DEFAULT 'active', -- active | archived
      archived_at TEXT,
      archive_outcome TEXT,                -- completed | cancelled
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE nodes(
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      start_utc TEXT,
      end_utc TEXT,
      status TEXT NOT NULL DEFAULT 'pending', -- pending | in_progress | completed | cancelled
      position INTEGER NOT NULL
    );
    CREATE TABLE links(
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,                  -- url | file
      title TEXT NOT NULL DEFAULT '',
      target TEXT NOT NULL,                -- URL 或绝对路径
      meta TEXT NOT NULL DEFAULT '{}'      -- 名称/大小/修改时间等
    );

`tasks:delete` 只接受活跃任务。应用服务在单个事务中删除该任务的 `change_events`，再删除 `tasks`；`nodes`、`links`、`notes`、`reminders` 由已启用的外键级联清理。renderer 在真正调用前提供二次确认与 5 秒撤销窗口。该扩展复用现有 TEXT 状态列与外键，不需要 SQLite schema 迁移。
    CREATE TABLE notes(
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      body TEXT NOT NULL DEFAULT '',       -- Markdown
      updated_at TEXT NOT NULL
    );
    CREATE TABLE change_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      at_utc TEXT NOT NULL,
      kind TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE reminders(
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      offset_minutes INTEGER NOT NULL,
      fire_at_utc TEXT NOT NULL,
      fired INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE drafts(
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,                -- mcp | api | pi
      payload TEXT NOT NULL,               -- 草稿 JSON
      state TEXT NOT NULL DEFAULT 'pending', -- pending | confirmed | discarded
      created_at TEXT NOT NULL
    );
    -- migration v2
    CREATE TABLE agent_sessions(
      id TEXT PRIMARY KEY, title TEXT NOT NULL, model TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE agent_messages(
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,                  -- user | assistant | tool
      content TEXT NOT NULL,               -- 仅用户可见文本/脱敏工具状态
      tool_name TEXT,
      sequence INTEGER NOT NULL,            -- 会话内严格顺序；唯一索引(session_id, sequence)
      created_at TEXT NOT NULL
    );

规则：WAL + foreign_keys=ON；schema 变更只走 `db.ts` 中按版本登记的迁移；时间一律 UTC 存 ISO8601，展示按 tz_id 换算；ID 用 GUID；排序必有稳定 tie-breaker。

## 6. MCP 契约（Qoder 兼容通道）

- **传输 1（SSE，主）**：GUI 启动后监听 http://127.0.0.1:<随机端口>/sse?token=<随机令牌>（经典 SSE，Qoder 桌面 IDE 的 SSE 模式）；仅绑定回环地址；token 为 24 字节随机 base64url，在内存中使用并以 safeStorage 密文保存，可在设置页复制/重置。旧版 SQLite 明文值在启动时迁移并删除；解密/迁移失败则删除旧值并重新生成。
- **传输 2（Streamable HTTP）**：http://127.0.0.1:<随机端口>/mcp?token=<随机令牌>（Qoder CLI -t http 使用；原始握手已验证）。
- **传输 3（STDIO，备）**：`node "<应用目录>/scripts/caiban-stdio.mjs"` 桥接脚本，把 stdio JSON-RPC 转发到 GUI 的 SSE 端点；GUI 未运行时自动拉起。注意：Windows GUI 子系统程序没有可用 stdio 管道，不能用 exe 直接做 stdio MCP（已踩坑记录）。
- **鉴权**：仅"创建会话"的请求校验 token（错误 token 返回 401）；携带 sessionId 的后续请求以随机会话 ID 本身为凭据（SDK 客户端从 endpoint 事件拿到的地址不含原 URL 的 token）。
- **会话模型**：每个会话使用独立的 MCP Server 实例（Server 只能连接一个传输，重复 connect 会返回 400 "Server already initialized"）。
- **工具集**（全部"只读 + 草稿"，禁止直接修改正式数据）：

| 工具 | 参数 | 返回 |
| --- | --- | --- |
| list_active_tasks | 无 | 活跃任务列表（id、名称、deadline、紧急度、进度、下一节点） |
| get_task_detail | task_id | 任务全量只读详情（含节点、链接） |
| propose_task_draft | draft{name, description?, deadline?, urgency?, nodes[]} | draft_id 与校验结果；草稿进入岛内审核面板 |
| propose_node_draft | task_id, nodes[] | draft_id；为已有任务建议节点拆解 |

- 日志：只记录工具名、耗时、成功/失败类别；禁止记录请求正文与敏感内容。
## 7. 内置 LLM 兜底通道

- 配置：Base URL、API Key、模型名（设置页；Key 经 safeStorage 加密落盘）。
- 调用：OpenAI-compatible /chat/completions，带 function call 工具 schema（与 MCP 工具 propose_task_draft / propose_node_draft 同形），temperature 0.2。
- 校验：输出经 shared 校验器（字段、枚举、日期、顺序、长度）严格验证；失败自动修复一次，再失败转可编辑失败草稿并保留错误类别。
- 与 MCP 通道共用 drafts 表与审核 UI。

## 7.1 原生 Pi Agent（P14 默认通道）

固定数据流：`L3 Agent UI → preload 白名单 IPC → AgentService → PiAgentAdapter → allowlist 工具 → 草稿/操作提案 → 用户逐次确认 → AppService 事务写入`。

- provider：Pi `deepseekProvider()`；Base URL 固定 `https://api.deepseek.com`，模型只允许 `deepseek-v4-flash` / `deepseek-v4-pro`，Key 单独以 safeStorage 密文保存。
- 生命周期：进程内只允许一个活跃 run；provider 请求超时 60 秒、run 超时 3 分钟、最多 12 轮。取消信号贯穿 provider 与工具；L3 卸载和应用退出释放订阅与队列。
- 会话：migration v2 保存可见用户/assistant 文本、脱敏工具状态、模型、摘要和 token 用量。本机长期保留，支持单删、全清与 JSON/Markdown 导出。
- 可见性：只映射 Pi `text_delta`；`thinking_*` 永不进入 IPC、SQLite 或导出。工具结果只保存“读取完成/已生成草稿/失败”状态，不保存原始正文。
- 工具：固定 5 个 allowlist 工具。文件链接目标对模型脱敏为 `[本地文件]`；无 shell、文件读取、URL 请求或任意网络能力。
- 操作提案：`action` 草稿不可编辑，保存服务端快照的预期旧值；确认事务先做乐观并发检查。操作写入与草稿状态/审计事件同事务，`AppService` 在提交后通知后置逻辑。节点删除由 renderer 增加二次确认和 5 秒撤销。

## 8. 安全

- API Key 仅经 safeStorage 加密保存；禁止写入日志、快照、备份、测试夹具与源代码。
- PersonalBaseToken 与 API Key 同级待遇（safeStorage、日志脱敏、不进快照/备份/测试夹具）。
- MCP 仅 127.0.0.1 + token；token 只以 safeStorage 密文落盘，重置后新会话立即拒绝旧 token。
- 草稿原则：任何 AI 输出不得直接落正式数据；创建、编辑与确认复用 shared 校验，确认前最终校验任务仍有效，确认走单事务。
- 正式任务、节点、链接、备注、提醒和草稿确认统一由 `AppService` 编排；事务提交后才发送变更通知，供飞书自动同步等后置逻辑消费。
- Markdown 渲染禁用原始 HTML/脚本；打开外部链接前显示实际目标。
- 备份与快照不含凭据；日志脱敏（无 Authorization、无请求正文）。

## 9. 归档与快照

目录：%APPDATA%\caiban-island\archive\YYYY-MM\任务名\

- task.json：format_version=1、exported_at、app_version、task、nodes、links、notes、change_events；
- task.md：可读 Markdown（标题、deadline、紧急度、说明、节点清单含状态、链接清单、备注正文）；
- 恢复：以 task.json 为源校验后重建为活跃任务，原归档记录保留。

## 10. 打包与分发

- electron-builder 在本地产出免安装独立 EXE、解压目录与验收用 zip；GitHub Release 只上传 `Caiban-Island-${version}-Windows-x64.exe`，避免重复下载项；asar 打包资源；
- 无代码签名：README 说明 SmartScreen"仍要运行"为正常现象，不尝试绕过；
- 通知显示：启动时 app.setAppUserModelId 并确保开始菜单快捷方式存在（Win10 图标正确显示所需）；
- 目标平台：Win10 1809+ x64、Win11 x64；Arm64 为后续评估项。
- `CAIBAN_TEST_USER_DATA_DIR` 仅在未打包开发/测试运行时生效，且目标必须位于系统临时目录；生产包拒绝该覆盖。视觉与集成测试不得依赖 `%APPDATA%` 覆盖来隔离数据。
- `CAIBAN_TEST_INITIAL_LEVEL` 仅在上述隔离目录已生效且应用未打包时接受 `l2`/`l3`，用于确定性截图，不改变生产启动层级。
- `CAIBAN_TEST_HOLD_LEVEL=1`、`CAIBAN_TEST_REMOTE_DEBUGGING_PORT` 与 `CAIBAN_TEST_COLOR_SCHEME=dark` 同样要求未打包且隔离目录已启用，只用于保持截图层级、开放本机 CDP 和确定性主题；生产包忽略它们。
- `CAIBAN_TEST_DISABLE_HARDWARE_ACCELERATION=1` 仅在未打包且隔离目录已生效时于 app ready 前禁用硬件加速，用于验证软件渲染降级；生产包拒绝该覆盖。

## 11. 目录结构（P1 建立）

    caiban-island/
      docs/            # 本套文档
      src/
        main/          # 主进程：窗口/托盘/MCP/DB/通知
        preload/       # contextBridge 白名单
        renderer/      # React UI（组件、面板、状态）
        shared/        # 类型、IPC 名、设计 token、schema 校验
      tests/           # Vitest 单测/集成
      scripts/         # 打包与辅助脚本
      package.json
      electron.vite.config.ts
      electron-builder.yml

## 12. 飞书多维表格同步

- **通道 1（主）**：内置直连飞书多维表格 Open API（bitable v1，https://open.feishu.cn/open-apis），凭据为 PersonalBaseToken 个人令牌（用户在多维表格开发者入口自助生成，企业免管理员审批）；令牌经 safeStorage 加密保存（feishu_token_enc），与 API Key 同级待遇。
- **通道 2（兜底）**：CSV（UTF-8 BOM）/ Markdown 导出到 %APPDATA%\caiban-island\export\，可导入飞书多维表格；始终可用，不依赖任何凭据。
- **自动建表**：首次同步自动创建多维表格"采办岛任务"与数据表（13 个字段：采办岛任务ID/任务名称/类型/紧急程度/截止时间/状态/进度/下一节点/时间轴节点/网页链接/文件链接/备注/最后同步时间），app_token 与 table_id 存 settings。
- **同步语义**：按"采办岛任务ID"字段检索（records/search，operator is）→ 存在则 batch_update、否则 batch_create（每批 ≤50）；重复同步幂等；仅同步活跃任务；自动同步（设置开关）在任务变更后防抖 3s 触发。
- **错误处理**：令牌失效（99991668 等）给出可操作错误；限流自动失败不阻塞本地使用。
- **开发钩子**：ISLAND_DEBUG=1 时 settings 键 feishu_base_url 可覆盖 API 基址（对接本地 mock 测试）。

## 13. P12 窗口过渡与渲染能力

- `IslandWindowController` 保存已经稳定的 `level`，并以唯一 transition id 协调 `preparing → animating → settling`。展开先提交一次目标原生尺寸，收起先完成视觉缩放再提交一次目标尺寸；禁止定时循环调用 `setBounds`。
- renderer 在 preparing 阶段保留稳定的源层；所有跨层级目标均由轻量同骨架预览层承接动画，完整 L2/L3 在 settling 后渐进挂载。main 在 80ms 后可强制进入动画。renderer 在动画结束确认 finished；main 在 280ms 后可强制收尾。旧 id 的确认全部忽略。
- 动画期间 `setIgnoreMouseEvents(true, { forward: true })`，目标落定后才恢复交互。preparing 阶段反向请求取消；其余并发请求仅保留最后目标。
- `RenderMode` 根据 `gpu-info-update` 后的 `gpu_compositing` 状态分类：`composited` 使用 200ms 完整形变，`software` 使用 120ms 淡入淡出，`direct` 单帧完成。高对比度、减少动画或 GPU 进程异常固定为 direct；未知状态保守使用 software。
- 不读取、记录或持久化显卡型号；不强制绕过 Chromium GPU blocklist。Acrylic 过渡期间使用纯色 fallback，Koffi/user32/SetWindowCompositionAttribute 绑定按进程惰性缓存。
- `scripts/benchmark-transitions.mjs` 只连接显式传入的本机 CDP 端口，输出首帧、稳定耗时、rAF、Long Tasks、resize、DOM 与 TaskCard 数量，并在 `--assert` 下执行确定性门禁；启动进程仍必须使用系统临时目录中的隔离数据。
- task store 在 App 生命周期内缓存任务列表、onboarded 设置与按任务 ID 的详情；L2 Carousel 保留完整逻辑轨道，但只挂载可见范围和两侧 overscan，最多 7 张 TaskCard。
