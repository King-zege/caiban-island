# Pi Agent 与后续能力交接说明

> 本文用于把采办岛当前实现交接给后续开发者。产品、架构和验收的正式定义仍分别以 `SPEC.md`、`ARCHITECTURE.md`、`DESIGN_SYSTEM.md`、`TEST_PLAN.md` 和 `PLAN.md` 为准；本文不替代这些规范。

## 1. 当前基线

- 仓库：<https://github.com/King-zege/caiban-island>
- 分支：`main`
- 发布版本：`v0.2.0`
- 已推送功能基线：`8371f4d`（P19，`origin/main`）
- 当前本地功能基线：`7006979`（P19 杂事完成改为立即提交）
- Release 页面：<https://github.com/King-zege/caiban-island/releases/tag/v0.2.0>
- Release 资产：`Caiban-Island-0.2.0-Windows-x64.exe`
- Release 资产 SHA-256：`A34E1B631571031FD817B72D9150150CFEBA0481614C4FD438B88D415CBE52EC`
- 历史 `v0.2.0` 标签仍指向 `ddeaa22`，本次发布没有强制改写标签；Release 说明中已明确链接 P19 源码提交 `8371f4d`
- 已完成里程碑：P0–P19
- 数据库迁移：v1–v5

P19 提交前门禁结果：

- `npm run typecheck`：通过
- `npm test`：38 个测试文件、209 项测试通过
- `npm run build`：通过
- `npm run package`：通过
- 凭据与私人路径检测：0 项

### P19 后续调整

提交 `7006979` 已把 L2 杂事的独立完成按钮从“延迟 5 秒提交并可撤销”改为“立即归档并显示成功/失败反馈”，同时收窄通用撤销队列，使其只负责删除操作。该提交已独立完成并在 2026-08-28 复核：typecheck、38 个测试文件共 209 项测试、build 与 Windows package 全部通过；凭据与私人路径扫描无真实命中。

继续开发前请先完整阅读仓库根目录的 `AGENTS.md`，然后依次阅读上述五份正式文档。发现本文与正式文档冲突时，以正式文档为准，并在实现前消除文档冲突。

## 2. 应用现状

采办岛是一个 Windows Electron 桌面任务应用，主要界面分为三层：

- L1：折叠岛，仅展示精简状态。
- L2：任务卡片与快捷操作区。
- L3：任务详情、草稿审核、Agent、记忆和设置等完整工作区。

Renderer 不直接访问 Node API、SQLite、文件系统或网络。所有能力必须通过 preload 白名单 IPC 进入 main；正式数据的变更统一由 `AppService` 编排并在事务提交后发送通知。

P12 已完成透明窗口、点击穿透、磨砂与窗口合成边界。后续调整 UI 时不要扩大透明点击区域，也不要绕过既有的窗口状态机。

## 3. Pi 上游与锁定依赖

首版原生 Agent 固定使用官方 Pi v0.81.1：

- 上游版本：`v0.81.1`
- 上游提交：`20be4b18d4c57487f8993d2762bace129f0cf7c6`
- `@earendil-works/pi-agent-core@0.81.1`
- `@earendil-works/pi-ai@0.81.1`
- 许可证：MIT

本项目只引入上述两个包。禁止引入 `pi-coding-agent`、TUI、Pi 的文件/终端工具或 Pi 自带会话目录。Electron 运行时满足这两个包的 Node 版本要求。

Pi 包为 ESM，打包时必须保留当前的 bundling/lazy-provider 处理。任何升级都要重新核验：

- provider 与 tool-call 事件兼容性；
- `@google/genai`、`protobufjs` 等传递依赖及安装脚本；
- ASAR 收集、便携包启动和离线回退；
- 许可证、审计结果、安装包体积和常驻内存。

不要在首次维护中擅自升级到其他 Pi 版本。

## 4. 已实现的 Agent 架构

固定数据流为：

`L3 Agent UI → preload 白名单 IPC → AgentService → PiAgentAdapter → allowlist 工具 → 草稿/操作/记忆提案 → 用户确认 → AppService 事务写入`

主要实现位于：

- `src/main/agentService.ts`
- `src/main/piAgentAdapter.ts`
- `src/main/agentSessionService.ts`
- `src/main/agentTools.ts`
- `src/main/memoryService.ts`
- `src/shared/taskContracts.ts`
- `src/shared/draftContracts.ts`
- `src/renderer/src/components/`
- `src/renderer/src/panels/`

运行边界：

- 同一时间只允许一个活跃 Agent run；
- 会话支持多轮对话和本地长期保留；
- 单请求超时 60 秒，整次 run 最长 3 分钟，最多 12 个模型轮次；
- L3 收起、取消、超时或应用退出时中止 provider 和工具调用；
- 不保存或展示模型内部 reasoning，只持久化用户可见文本、必要协议和脱敏工具结果。

Pi 是默认原生通道；Qoder MCP 与旧简单 LLM 仍作为兼容和故障回退，配置彼此独立。

## 5. DeepSeek 配置

- Base URL 固定为 `https://api.deepseek.com`。
- 默认模型：`deepseek-v4-flash`。
- 可选模型：`deepseek-v4-pro`。
- API Key 只经 Electron `safeStorage` 加密保存。
- Key 不得进入 SQLite 明文、日志、快照、导出、测试夹具或源代码。

自动化测试必须使用 faux/mock provider，不得读取开发者或用户的真实 Key。真实连接测试只能人工执行，且日志中不得出现凭据或 Authorization header。

## 6. 工具与正式数据边界

当前 Agent allowlist 共七个工具：

- `list_active_tasks`
- `get_task_detail`
- `propose_task_draft`
- `propose_node_draft`
- `propose_task_action`
- `propose_memory`
- `search_sessions`

Agent 永远不能直接写正式任务数据。任务和节点规划进入草稿审核；轻量操作每次只形成一个提案，并展示明确的前后差异。用户逐次确认后，才由 `AppService` 在事务中执行。

轻量操作提案保存预期旧值，确认时进行乐观并发检查。正式数据已变化时必须拒绝执行并要求重新规划。节点删除继续使用二次确认和 5 秒撤销。

Agent 不得获得任意文件、Shell、URL 或通用网络工具。未来新增工具时，必须同步更新 shared DTO、IPC 白名单、校验、审计和测试。

## 7. 会话与长期记忆

P14 已实现 Agent 会话、可见消息、摘要、模型和使用量的本地持久化，并支持会话删除、清除及 JSON/Markdown 导出。

P15 的长期记忆采用两层有界结构：

- 用户画像：最多 1,375 字符；
- 工作/业务记忆：最多 2,200 字符。

记忆只能由 `propose_memory` 提议 add/replace/remove，且必须带类别、简短事实和证据消息 ID。用户可编辑、确认或拒绝；未确认内容不得进入系统提示。

写入前执行重复检查、不可见 Unicode 检查、提示注入模式扫描和凭据外泄模式扫描。达到容量 80% 时提出合并或删除建议，禁止静默淘汰。

已确认记忆在新建或重新载入会话时注入一次。`search_sessions` 使用本地 FTS5 返回有限片段和摘要，不返回 reasoning 或原始工具输出。

允许记忆：用户习惯、沟通偏好、采购流程规则、供应商和品类等经确认的业务事实。禁止记忆：凭据、Authorization、私人文件内容、原始大段对话和临时绝对路径。

## 8. 数据库迁移

- v1：既有任务、节点、提醒、草稿、设置等基础数据。
- v2：Agent 会话、可见消息、摘要、模型与使用量。
- v3：`memories`、`memory_proposals` 和会话消息 FTS5 索引。
- v4：一节点一条的 `node_reminders` 及到期索引。
- v5：杂事精确提醒字段、`misc_reminders` 及到期索引；旧杂事说明并入备注，旧 deadline 保留为待处理字段但不再自动通知。

所有 schema 变更必须新增版本化迁移，禁止启动时执行未版本化 DDL。升级测试要覆盖旧库迁移、失败回滚和重复启动幂等性。

## 9. P16–P19 任务体验

P16 已实现节点精确开始时间与提醒：

- L2 点击节点打开显式操作菜单，不自动循环状态；
- 菜单提供四态选择和设置、修改、清除提醒时间；
- 节点 `startUtc` 作为准时提醒时间，未设置则不提醒；
- 完成、取消、删除节点或归档任务会取消提醒；
- 调度器原子领取实际到期提醒，并支持启动/唤醒时的漏发摘要；
- 通知点击进入对应任务的 L3 节点区域。

P17 已把任务重要程度改为可调整的快捷按键。

P18 已实现：

- L2 按任务重要程度排序，越紧急越靠前，并保留稳定 tie-breaker；
- L2 可展开查看附加链接和文件地址；
- 任务名和节点名提供后续编辑入口；
- 名称修改仍经过 shared/main 校验和白名单 IPC。

P19 已把任务分为两套明确模型：

- 采购项目保留节点、资料、截止时间、紧急程度和项目提醒；
- 杂事只保留名称、备注、链接/附件和一次精确提醒，不允许节点、截止时间和紧急程度；
- L2 上层为项目卡片，下层为 216×88px 杂事工作单，并按已到时间、未来提醒、无提醒及稳定 ID 排序；
- 杂事工作单正文进入 L3 无页签单页；独立完成按钮立即归档并显示结果反馈；
- L3 侧栏和移动选择器按“采购项目 / 杂事”分组；
- 杂事提醒与项目、节点提醒统一原子领取、漏发摘要和通知导航；
- Pi、Qoder MCP 与旧简单 LLM 均按判别式 schema 生成两类草稿，确认前不写正式数据；
- 归档 JSON 已升级为格式版本 2，CSV、Markdown 和飞书导出按任务类型输出字段。

后续改动须保持键盘操作、焦点恢复、44×44px 触控目标、拖动隔离、读屏标签和高对比度行为。

## 10. 安全边界

- API Key、MCP token 和 PersonalBaseToken 同级保护，只能使用 `safeStorage`。
- MCP 只绑定 `127.0.0.1` 并校验 token。
- 日志只记录工具名、耗时及成功/失败类别。
- Markdown 禁用原始 HTML/脚本，外链打开前展示实际目标。
- 快照、导出和测试数据不得包含凭据、reasoning、Authorization 或私人绝对路径。
- AI 输出始终是草稿或提案；用户确认是正式写入的必要条件。

提交前除常规门禁外，应对 SQLite、日志、快照、导出和打包产物做凭据与私人路径扫描。

## 11. 打包与验收

项目使用 electron-builder 生成 Windows x64 portable 产物。P7 起完整门禁为：

```text
npm run typecheck
npm test
npm run build
npm run package
```

还需人工验证：

- portable EXE 可直接启动，主进程无 ESM/package exports 错误；
- Pi provider chunk 和运行依赖已收集进 ASAR；
- DeepSeek 正常、限流、断网和取消路径；
- L1/L2/L3 切换、透明点击、软件渲染及睡眠唤醒提醒；
- SQLite、日志和导出中没有 Key、token、reasoning 或测试凭据。

Windows GUI Electron 没有可用 stdio 管道；Qoder MCP 继续通过 `scripts/caiban-stdio.mjs` 桥接本地 SSE，不要把 stdio server 直接嵌入打包 EXE。

## 12. 后续私人知识库

P13–P19 尚未导入或索引用户文档。现有 `AgentContextProvider` 边界用于让任务、长期记忆、历史会话和未来知识库分别提供上下文。

私人知识库应作为独立里程碑设计，至少包括：

- 用户逐项授权文件或目录，不默认扫描磁盘；
- 来源、版本和删除同步可追踪；
- 分块、全文/向量检索及有限上下文窗口；
- 敏感内容过滤、凭据扫描和导出策略；
- 文件变更、移动、撤销授权后的索引清理；
- 与短小行为记忆分表、分服务、分提示注入。

不得把文档原文塞入 `memories`，也不得让 Agent 获得任意文件系统访问。

## 13. 新会话建议提示

后续接手时可使用：

> 请先完整阅读 `AGENTS.md`、`docs/SPEC.md`、`docs/ARCHITECTURE.md`、`docs/DESIGN_SYSTEM.md`、`docs/TEST_PLAN.md`、`docs/PLAN.md` 和 `docs/HANDOFF_PI_AGENT.md`。检查当前分支、工作区、最近提交、数据库迁移和打包配置，再说明你理解的当前基线、拟修改范围和验收门禁。未经明确要求不要升级 Pi，不要读取真实 API Key，也不要让 Agent 绕过草稿/提案确认写入正式数据。
