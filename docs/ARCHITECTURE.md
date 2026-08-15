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
| 动画 | motion（原 framer-motion） | spring 动画；只动 compositor 属性 |
| 数据库 | better-sqlite3 | 同步 API、快、WAL；主进程独占 |
| 磨砂 | koffi 调用 SetWindowCompositionAttribute | Win10 1803+/Win11 Acrylic；失败回退纯色 |
| MCP | @modelcontextprotocol/sdk | SSE server + STDIO shim |
| 内置 LLM | Node fetch（OpenAI-compatible） | function call 结构化输出 |
| 飞书同步 | Node fetch（飞书多维表格 bitable v1 Open API）+ PersonalBaseToken | 个人令牌免管理员审批；无 CLI 依赖 |
| Markdown | markdown-it（禁用 HTML）+ 自渲染 | 禁止原始 HTML 与脚本 |
| 打包 | electron-builder（portable zip，可选 NSIS） | 免证书绿色分发 |
| 测试 | Vitest（单测/集成） | 见 TEST_PLAN.md |

## 3. 进程分层

- **main（主进程）**：窗口管理（L1/L2/L3 形变、置顶、点击穿透 setIgnoreMouseEvents）、屏幕定位与热区轮询、磨砂、托盘、单实例锁、SQLite 全部访问、归档快照与备份、提醒调度、Windows Toast（setAppUserModelId + 开始菜单快捷方式）、开机自启、MCP 服务、内置 LLM 调用、safeStorage 安全存储。
- **preload**：contextBridge 暴露白名单 API，不含业务逻辑。
- **renderer（React UI）**：组件、面板、Zustand 状态；不直接访问 Node/DB/文件/网络，一切经 IPC。
- **shared**：类型、IPC 通道名、设计 token 常量、schema 校验器（main 与测试复用）。

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

- **传输 1（SSE，主）**：GUI 启动后监听 http://127.0.0.1:<随机端口>/mcp?token=<随机令牌>；仅绑定回环地址；token 为 24 位随机 base64url，可在设置页复制/重置。
- **传输 2（STDIO，备）**：采办岛.exe --mcp-stdio 启动 stdio MCP 服务，转发到 GUI 的本地端点；GUI 未运行时自动拉起 GUI。
- **工具集**（全部"只读 + 草稿"，禁止直接修改正式数据）：

| 工具 | 参数 | 返回 |
| --- | --- | --- |
| list_active_tasks | 无 | 活跃任务列表（id、名称、deadline、紧急度、进度、下一节点） |
| get_task_detail | task_id | 任务全量只读详情（含节点、链接） |
| propose_task_draft | draft{name, description?, deadline?, urgency?, nodes[]} | draft_id 与校验结果；草稿进入岛内审核面板 |
| propose_node_draft | task_id, nodes[] | draft_id；为已有任务建议节点拆解 |

- 认证：token 校验失败一律 401；来源非 127.0.0.1 一律拒绝。
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

- **通道 1（主）**：内置直连飞书多维表格 Open API（bitable v1），凭据为 PersonalBaseToken 个人令牌（用户在多维表格开发者入口自助生成，企业免管理员审批）；未配置令牌时功能入口提示引导。
- **通道 2（兜底）**：CSV / Markdown 导出文件，飞书多维表格"导入"；始终可用，不依赖任何凭据。
- 字段映射：见 SPEC FR-092；同步为单向导出，以岛内数据为准；按"采办岛任务ID"字段 upsert，重复同步幂等更新。
- 流程：feishu:test（测试连接）→ feishu:sync（建 app/表/字段 → 检索 → 批量新增/更新）；限流时指数退避重试（最多 3 次）。
- 安全：令牌 safeStorage 加密；请求日志只记录操作与耗时；令牌失效返回可操作错误。
- 自动同步：renderer 变更事件经 main 防抖 3s 触发全量 upsert；退出前保证最后一次同步完成，否则下次启动重试。
