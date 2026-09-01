# Agent 维护交接

本文件只保存接手 Agent 工作所需的当前状态。正式行为、架构、安全和验收分别以 `SPEC.md`、`ARCHITECTURE.md`、根目录 `AGENTS.md` 与 `TEST_PLAN.md` 为准。

## 1. 当前基线

- 分支：`main`；版本：`v0.3.0`；P0–P28 已完成。正式 Release：<https://github.com/King-zege/caiban-island/releases/tag/v0.3.0>（发布标签指向 `e0ade4b`）。
- 最近已验收节点：P26 Agent 自动化与每日清单、P27 性能与遗留实现清理、P28 Windows/安全/打包发布硬化。
- 数据库迁移：v1–v12。
- Pi：`@earendil-works/pi-agent-core@0.81.1`、`@earendil-works/pi-ai@0.81.1`，精确锁定，MIT。
- DeepSeek：官方 Base URL；`deepseek-v4-flash` / `deepseek-v4-pro`；Key 经 safeStorage。
- Qoder MCP、旧内置 LLM、stdio 桥和专用 DraftService 已删除；遗留 pending 草稿已转换为通用 AgentProposal。

P27 基线通过 typecheck、43 个测试文件/229 项测试与 build；首屏 renderer JS 为 759 KB，相比 P22 前约 1.20 MB 降低约 36%。P21 的 production transition benchmark、Windows 150% DPI/高对比度/减少动画验收仍有效。具体次数、尺寸和哈希不作为长期规范；重新发布时重新生成记录。

当前 v0.3.0 维护基线通过 typecheck、43 个测试文件/232 项测试、build 和 package；P28 的 `npm audit --omit=dev`（0 漏洞）、Windows 150% DPI 的 100 项合成数据截图和 transition `--assert` 验收仍有效。发布产物为 `Caiban-Island-0.3.0-Windows-x64.exe` 与同名 ZIP。

### v0.2.1 维护修复

- `execute_app_command` 原先仅输出顶层 `anyOf`，DeepSeek 将其识别为 `type: null` 并返回 400。当前 schema 为顶层 `type: object` + 判别联合 `anyOf`，测试同时覆盖工具定义与 DeepSeek 最终 HTTP payload。
- TypeBox provider 转换会按联合分支尝试转换值；可空 UTC schema 现将 `null` 分支置前，确保“无提醒”不会变为空字符串。
- system prompt 明确每轮只执行最新用户消息，避免修复后重放历史失败请求；Alt+F4 仅收起到 L1，真正退出才销毁窗口，轮询也会在窗口销毁后停止。

### v0.3.0 最终维护修复

- L2 Agent 是纯对话视图，只保留消息、临时思考/工具/审批状态和输入区；权限、目录、自动化、会话切换/新建、导出与删除只在 L3。
- L2/L3 共享 Agent store 与消息组件，不共享完整管理外壳。L3 每次进入都会从 SQLite 刷新当前会话；当前会话已删除时回退到最新会话。
- 消息视口在首次进入、重新进入和流式增长时自动定位最新内容；L2/L3 输入区固定可见，消息与会话列表各自滚动。
- DeepSeek 原生思考流仅在当前运行临时展示，正文开始后折叠为“思考过程”；不进入 SQLite、日志、搜索、记忆或导出。provider 请求超时为 120 秒并有限重试。
- 草拟合同允许信息不完整时先建卡：正式全名与简称至少填写一项，另一项由 main 规范化派生；供应商、合同号、金额和日期均可稍后补充。

## 2. 当前用户体验

- L2 默认展示采购项目、合同、杂事三轨卡片，可切换纯 Agent 对话；L3 使用同一个 Agent store 与消息组件，不存在第二套会话或“AI 草稿”页面。
- 从 L2 Agent 展开到 L3 保持并刷新当前会话，自动定位最新内容；从 L3 返回一律回到 L2 任务卡片。
- L2 保留输入、工具进度、错误重试和待确认操作；会话切换/新建、导出、删除、权限、目录和自动化管理只在 L3。
- 收起、切换和 renderer 重载不取消 run；不可见时用不含正文的系统通知恢复目标会话。
- 通用 AgentProposal 与记忆提案在 Agent 对话内审核；确认记忆只在新建或重新载入会话时进入上下文。

## 3. 实现入口

- `src/main/agentService.ts`：唯一 run、事件、快照、会话编排。
- `src/main/piAgentAdapter.ts`：Pi/DeepSeek 协议、流式文本和工具循环。
- `src/main/agentTools.ts`：工具 allowlist。
- `src/main/agentPermissionService.ts`：三档权限与审批。
- `src/main/contractService.ts`：合同台账、动作、提醒、资料与生命周期。
- `src/main/knowledgeService.ts`、`automationService.ts`：本地知识索引、持久化自动化、每日清单与固定模板 PDF。
- `src/main/appCommandService.ts`、`src/shared/appCommandContracts.ts`：统一正式命令。
- `src/main/authorizedFileService.ts`：授权目录文件边界。
- `src/main/agentSessionService.ts`、`src/main/memoryService.ts`：会话、FTS5 与记忆。
- `src/renderer/src/components/AgentPanel.tsx`、`AgentConversation.tsx`、`state/useAgentStore.ts`：统一 UI 与恢复状态。

固定数据流：

`L2/L3 Agent store + AgentConversation → preload IPC → AgentService → PiAgentAdapter → beforeToolCall → AppCommand/授权文件 → AppService`

## 4. 不可破坏的运行契约

- 全局一个 run；provider 请求 120 秒超时并有限重试，run 最长 15 分钟，最多 12 轮；取消信号贯穿 provider、审批和文件 I/O。
- renderer 先订阅事件再 bootstrap；sequence 出现缺口及发送返回、终态、层级切换、重载/重开时必须请求快照。
- 快照含 phase、lastActivityAt、partialText、仅当前运行可见的 partialThinking、activeTool、pendingApproval 和脱敏 error；assistant 消息必须先落库再广播 completed。
- 可持久化内容只包括用户/assistant 可见文本、脱敏工具状态、模型、摘要与使用量；思考增量允许通过当前运行 IPC 临时展示，但禁止进入 SQLite、日志、搜索、记忆和导出，原始工具正文同样禁止持久化。
- AppCommand 定义 schema、风险、预期旧值、摘要和撤销能力。未知工具 fail-closed；批准后继续原工具循环，拒绝/取消作为工具结果返回。
- Bypass 仍不能突破 AppCommand、授权目录、safeStorage、回环和无任意 shell/网络边界。

## 5. 工具与记忆边界

- 只读：活跃采购/杂事/合同详情、归档案例、历史会话、授权目录列举与文本读取、工作目录树/检索/来源片段/派生索引刷新。
- 写入：一个统一 `execute_app_command`；授权目录内写入、移动与单文件删除；记忆只形成提案。
- 文件参数只使用授权目录 ID 和相对路径。main 必须拒绝 `..`、设备/UNC、符号链接/联接逃逸与未授权相邻目录。
- `search_archived_cases` 和 `search_sessions` 只返回有界、脱敏片段，不返回备注全文、链接目标、文件内容、reasoning 或凭据。
- 记忆类别为 profile（1,375 字符）与 work（2,200 字符）；确认前执行证据归属、去重、不可见字符、提示注入、凭据和私人路径扫描。

## 6. 修改与验收

- 自动化只使用 faux/mock provider、隔离 SQLite 和合成文件，不读取真实 Key、任务或私人目录。
- Agent 变更至少覆盖：正常文本、工具循环、空响应、错误/断流/超时、取消、序号缺口、重载、三档权限、路径越界和 AppCommand schema。
- 端到端必须验证生成、修改、删除卡片和整理授权文件；L2/L3 会话连续、重新进入 L3 可读取最新消息并保留可滚动输入区，且未授权目录不变。
- 完成前执行 `npm run typecheck`、`npm test`、`npm run build`、`npm run package`，并按 `TEST_PLAN.md` 做 Windows/安全验收。

## 7. 后续方向

P25 由 `KnowledgeService` 实现本地知识库。P26 由 `AutomationService` 实现三档权限控制的持久化计划、每日清单和固定模板 PDF；模型只重排既有条目 ID 并给建议，失败时确定性降级。P27 将遗留 pending 草稿统一迁移至 AgentProposal，并按需加载 L3 与非当前编辑器。后续自动化执行器不得放开任意 shell、原始 cron 或网络。

接手提示：先读根目录 `AGENTS.md`，再按任务只读相关正式文档；检查分支、工作区、最新提交和迁移。未经明确需求不要升级 Pi、扩展网络/shell 权限或读取真实凭据。
