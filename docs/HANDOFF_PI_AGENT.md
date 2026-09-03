# Agent 维护交接

本文件只保存接手当前代码所需的信息。产品、架构、安全与验收分别以 `SPEC.md`、`ARCHITECTURE.md`、根目录 `AGENTS.md` 与 `TEST_PLAN.md` 为准；历史修复与发布说明查 Git 和 GitHub Release。

## 1. 当前基线

- 分支：`main`；产品版本：`v0.4.0`；数据库迁移：v1–v13。
- 正式 Release：<https://github.com/King-zege/caiban-island/releases/tag/v0.4.0>，标签指向 `35ead4e`。
- P30 自动化门禁：typecheck、44 个测试文件/264 项测试、build、package、production audit 与 ASAR 检查均通过；renderer 首屏 JS 为 772.48 KB，回升警戒线为 840 KB。真实 Peng/飞书企业沙箱仍按 `TEST_PLAN.md` 人工验收。
- Pi 包精确锁定为 `@earendil-works/pi-agent-core@0.81.1` 与 `@earendil-works/pi-ai@0.81.1`，MIT。
- Provider：DeepSeek 官方、智谱 GLM 官方开放平台/Coding Plan、Peng DeepSeek Chat Completions、Peng OpenAI Responses、Peng Anthropic Messages。三个 Peng Provider 共用一个 safeStorage Key、分别保存模型。

## 2. 当前产品事实

- L2 默认展示采购项目、合同、杂事三轨；Agent 模式只保留对话、临时思考/工具/审批状态与输入。权限、目录、自动化和会话管理只在 L3。
- L2/L3 共用 Agent store 与消息组件。进入或重新进入时定位最新消息；流式正文自动跟底。思考流只在当前 run 临时显示，正文开始后折叠，不落库、不进日志/搜索/记忆/导出。
- 合同允许信息不完整时先建草拟卡；卡片与 L3 显示合同号、供应商、金额、扫描件/附件/链接。合同可有多个节点，每个节点独立提醒。
- Agent 可检索主工作目录并运行一次性/每日/每周自动化；默认每日 09:00 生成会话和固定模板 PDF，无模型时确定性降级。
- 所有正式写入统一经过 AppCommand → AppService；飞书多维表格只单向同步采购项目。飞书机器人经长连接调用同一个 AgentService，不直接写库或调用本地 CLI。

## 3. 关键实现入口

| 入口 | 职责 |
| --- | --- |
| `src/main/agentService.ts` | 唯一 run、事件、快照、会话编排 |
| `src/main/agentProviderConfigService.ts` | Provider、URL、模型与加密 Key 配置 |
| `src/main/piAgentAdapter.ts` | 流式 Provider 协议与工具循环 |
| `src/main/feishuAgentBridge.ts` | 飞书 Channel、配对、会话映射、进度/审批卡与防重 |
| `src/main/agentTools.ts` / `agentPermissionService.ts` | 工具 allowlist、风险与三档权限 |
| `src/main/appCommandService.ts` / `src/shared/appCommandContracts.ts` | 正式命令、schema、差异与并发前置值 |
| `src/main/contractService.ts` | 合同台账、资料、多节点、逐节点提醒与生命周期 |
| `src/main/knowledgeService.ts` / `automationService.ts` | 本地知识索引、自动化、每日清单与 PDF |
| `src/main/authorizedFileService.ts` | 授权目录与路径逃逸防护 |
| `src/main/agentSessionService.ts` / `memoryService.ts` | 会话、FTS5 与确认记忆 |
| `src/renderer/src/components/AgentPanel.tsx` / `AgentConversation.tsx` / `state/useAgentStore.ts` | L2/L3 Agent UI 与状态恢复 |

固定调用链：

`L2/L3 Agent 或 FeishuAgentBridge → AgentService → PiAgentAdapter → beforeToolCall → AppCommand/授权文件工具 → AppService`

## 4. 不可破坏的契约

- 全局只有一个 run；provider 单次请求超时 120 秒并有限重试，run 最长 15 分钟、最多 12 轮；取消信号贯穿 provider、审批和文件 I/O。
- renderer 先订阅事件再 bootstrap；sequence 缺口、发送返回、终态、层级切换、重载或重开时必须以快照补偿。
- assistant 消息先落库再广播 completed。快照可含临时 `partialThinking`，但结构化思考和工具原文不得持久化。
- 所有 Provider 工具参数保持顶层 `type: object`；可空 UTC 保持真正的 `null`。未知工具 fail-closed。
- Bypass 也不能突破 AppCommand、授权目录、safeStorage、本地回环以及无任意 shell/网络边界。
- 文件工具只接受授权目录 ID 与相对路径；main 拒绝 `..`、设备/UNC、符号链接/联接逃逸和未授权相邻目录。
- Peng OpenAI 类协议固定 `/v1` Base URL，Anthropic 固定根 URL；协议由用户显式选择。连接测试只发送固定“仅回复 OK”，模型目录使用 Bearer `GET /v1/models`。
- 飞书 App Secret、配对码和消息正文不得进入日志；进度卡不得发送 thinking、原始工具结果或敏感路径。仅当前飞书 run 原发起人能操作审批/取消。

## 5. 修改与验收

- 测试只使用 faux/mock provider、隔离 SQLite、合成 Key 和系统临时目录，不读取真实任务、凭据或私人文件。
- Agent 变更覆盖文本、工具循环、思考分流、空响应、认证/限流/5xx、断流、超时、取消、序号补偿、重载与三档权限。
- 合同变更覆盖不完整草拟卡、金额精度、资料路径、多节点/提醒、状态机、事务回滚和并发冲突。
- 完成前执行 `npm run typecheck`、`npm test`、`npm run build`；发布相关改动再执行 `npm run package`，并按 `TEST_PLAN.md` 做安全与 Windows 验收。

## 6. 接手顺序与后续方向

先读 `AGENTS.md`，再按任务读取对应正式文档；开始前检查分支、工作区、最新提交和迁移。未经明确需求不要升级 Pi、放开网络/shell 边界或读取真实凭据。

候选增强统一记录在 `PLAN.md`；当前包括 OCR/旧 Office 提取、自定义排序与节点依赖、多显示器/Arm64、附件托管、数据库加密及经重新评估的飞书双向同步。
