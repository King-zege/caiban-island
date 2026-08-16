# 采办岛 v1 技术架构

## 1. 架构目标

架构优先保证四件事：原生窗口与动画体验（透明、置顶、磨砂、60fps）、本地数据可靠性（SQLite + 快照 + 自动备份）、LLM 权限可审计（Qoder MCP 与内置 API 都只产草稿）、核心业务可在不启动 UI 的情况下测试。

## 2. 技术栈决策

| 领域 | 决策 | 说明 |
| --- | --- | --- |
| 运行时 | Electron（实施时锁定最新稳定版） | Win10/Win11 透明置顶窗口方案成熟 |
| 语言 | TypeScript（strict） | 主进程/渲染层同语言 |
| UI | React 19 + Vite（electron-vite） | 组件化、HMR 快 |
| 状态 | Zustand | 轻量、配合 React 18/19 |
| 图标 | lucide-react | 用户锁定的单一线性图标家族；全局统一 1.75px stroke |
| 动画 | 主进程窗口插值 + CSS compositor 动画 | 窗口形变在 main；renderer 只动画 transform/opacity/border-radius |
| 数据库 | better-sqlite3 | 同步 API、快、WAL；主进程独占 |
| 磨砂 | koffi 调用 SetWindowCompositionAttribute | Win10 1803+/Win11 Acrylic；失败回退纯色 |
| MCP | @modelcontextprotocol/sdk | SSE server + STDIO shim |
| 内置 LLM | Node fetch（OpenAI-compatible） | function call 结构化输出 |
| 飞书同步 | Node fetch（飞书多维表格 bitable v1 Open API）+ PersonalBaseToken | 个人令牌免管理员审批；无 CLI 依赖 |
| Markdown | markdown-it（禁用 HTML）+ 自渲染 | 禁止原始 HTML 与脚本 |
| 打包 | electron-builder（portable zip，可选 NSIS） | 免证书绿色分发 |
| 测试 | Vitest + Testing Library + user-event + jsdom + axe + Electron 视觉回归 | 单元、交互、无障碍与确定性截图，见 TEST_PLAN.md |

## 3. 进程分层

- **main（主进程）**：窗口管理（L1/L2/L3 形变、置顶、点击穿透 setIgnoreMouseEvents）、屏幕定位与热区轮询、磨砂、托盘、单实例锁、SQLite 全部访问、归档快照与备份、提醒调度、Windows Toast（setAppUserModelId + 开始菜单快捷方式）、开机自启、MCP 服务、内置 LLM 调用、safeStorage 安全存储。
- **preload**：contextBridge 暴露白名单 API，不含业务逻辑。
- **renderer（React UI）**：组件、面板、Zustand 状态；不直接访问 Node/DB/文件/网络，一切经 IPC。
- **shared**：类型、IPC 通道名、设计 token 常量、schema 校验器（main 与测试复用）。

设计 token 以 `src/shared/designTokens.ts` 为唯一来源。renderer 把语义 token 映射为根节点 CSS variables；组件不得维护第二份颜色、圆角或间距常量。

## 4. IPC 通道白名单

| 通道 | 方向 | 说明 |
| --- | --- | --- |
| tasks:list / detail / create / update / complete / cancel | renderer→main | 任务 CRUD 与详情（完成/取消即归档） |
| nodes:add / update / remove / setStatus / reorder | renderer→main | 节点操作（三态、排序） |
| links:add / remove | renderer→main | 链接管理（URL 仅 http/https） |
| notes:save | renderer→main | 备注保存（每任务一条，Markdown） |
| reminders:list / set | renderer→main | 提醒提前量管理（仅 deadline 任务） |
| drafts:list / get / confirm / discard | renderer→main | AI 草稿审核（P5） |
| archive:list / search / get / restore | renderer→main | 归档查询、恢复（快照导出在主进程完成/取消时执行） |
| settings:getAll / set | renderer→main | 设置（默认提醒、自启、磨砂开关） |
| feishu:sync / feishu:test / feishu:export | renderer→main | 飞书同步、连接测试、CSV/Markdown 导出（P6） |
| mcp:getConfig / resetToken | renderer→main | MCP 配置展示与令牌重置（P5） |
| system:openUrl / openPath / showInFolder | renderer→main | 系统打开动作 |
| window:setLevel / setL2Detail / activate | renderer→main | 窗口三级控制、速览加高、焦点激活 |
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
      status TEXT NOT NULL DEFAULT 'pending', -- pending | in_progress | completed
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
      source TEXT NOT NULL,                -- mcp | api
      payload TEXT NOT NULL,               -- 草稿 JSON
      state TEXT NOT NULL DEFAULT 'pending', -- pending | confirmed | discarded
      created_at TEXT NOT NULL
    );

规则：WAL + foreign_keys=ON；schema 变更走版本化迁移（migrations 目录）；时间一律 UTC 存 ISO8601，展示按 tz_id 换算；ID 用 GUID；排序必有稳定 tie-breaker。

## 6. MCP 契约（Qoder 主通道）

- **传输 1（SSE，主）**：GUI 启动后监听 http://127.0.0.1:<随机端口>/sse?token=<随机令牌>（经典 SSE，Qoder 桌面 IDE 的 SSE 模式）；仅绑定回环地址；token 为 24 字节随机 base64url，可在设置页复制/重置。
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

## 8. 安全

- API Key 仅经 safeStorage 加密保存；禁止写入日志、快照、备份、测试夹具与源代码。
- PersonalBaseToken 与 API Key 同级待遇（safeStorage、日志脱敏、不进快照/备份/测试夹具）。
- MCP 仅 127.0.0.1 + token；重置 token 使旧连接立即失效。
- 草稿原则：任何 AI 输出不得直接落正式数据；确认走单事务。
- Markdown 渲染禁用原始 HTML/脚本；打开外部链接前显示实际目标。
- 备份与快照不含凭据；日志脱敏（无 Authorization、无请求正文）。

## 9. 归档与快照

目录：%APPDATA%\caiban-island\archive\YYYY-MM\任务名\

- task.json：format_version=1、exported_at、app_version、task、nodes、links、notes、change_events；
- task.md：可读 Markdown（标题、deadline、紧急度、说明、节点清单含状态、链接清单、备注正文）；
- 恢复：以 task.json 为源校验后重建为活跃任务，原归档记录保留。

## 10. 打包与分发

- electron-builder portable 目标产出绿色目录 + zip；asar 打包资源；
- 无代码签名：README 说明 SmartScreen"仍要运行"为正常现象，不尝试绕过；
- 通知显示：启动时 app.setAppUserModelId 并确保开始菜单快捷方式存在（Win10 图标正确显示所需）；
- 目标平台：Win10 1809+ x64、Win11 x64；Arm64 为后续评估项。
- `CAIBAN_TEST_USER_DATA_DIR` 仅在未打包开发/测试运行时生效，且目标必须位于系统临时目录；生产包拒绝该覆盖。视觉与集成测试不得依赖 `%APPDATA%` 覆盖来隔离数据。

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
