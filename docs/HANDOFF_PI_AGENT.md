# Agent 维护交接

本文件只保存接手当前代码所需的信息。产品、架构、安全与验收分别以 `SPEC.md`、`ARCHITECTURE.md`、根目录 `AGENTS.md` 与 `TEST_PLAN.md` 为准；历史修复与发布说明查 Git 和 GitHub Release。

## 1. 当前基线

- 分支：`main`；产品版本：`v0.4.0`；数据库迁移：v1–v13；P30 实现提交为 `6656236`。
- 当前源码为 P31 验收中候选：飞书自接向导、诊断与远程强制审批，以及 Peng 单一入口合并；本次只提交源码、测试和文档，不更新 Release、标签或线上下载资产。
- 正式 Release：<https://github.com/King-zege/caiban-island/releases/tag/v0.4.0>，标签指向 `35ead4e`，仍是生产下载入口。
- P30 预发布测试版：<https://github.com/King-zege/caiban-island/releases/tag/p30-test-20260903>，标签 `p30-test-20260903` 指向 `6656236`，包含 Windows x64 portable EXE 与 ZIP；不要把它宣称为正式 `v0.5.0`。
- P30 自动化门禁：typecheck、44 个测试文件/264 项测试、build、package、production audit 与 ASAR 检查均通过；renderer 首屏 JS 为 772.48 KB，回升警戒线为 840 KB。测试资产 SHA-256：EXE `EC677434A4B971945FE90E886555C02A55D36D8AB1C4E8DC081ED6B4ED19FCFE`，ZIP `6DC4A2DDBF562DC373F6FAC44E2302D322E5A3229106E8E946B6AB3468D1BAD7`。
- P31 本地候选已通过 typecheck、44 个测试文件/272 项测试、build、package、production audit、ASAR 与凭据扫描；renderer 首屏 JS 为 776.11 KB。候选资产 SHA-256：EXE `0D57BD77FE3BD3325D672D0DEB984F97F0E6B5BCF5DA67C2F5AEA9A3BED0AE80`，ZIP `EAE1A4555BDB099E8BE4BA0DB4D76ABB60298251FD31735A951FCEFD86DB19D4`。package 使用本地同版本 Electron 43.4.0 distribution 完成，不改变发布配置。
- Pi 包精确锁定为 `@earendil-works/pi-agent-core@0.81.1` 与 `@earendil-works/pi-ai@0.81.1`，MIT。
- Provider：DeepSeek 官方、智谱 GLM 官方开放平台/Coding Plan、单一 Peng 企业网关。Peng 固定 `/v1` 并使用 OpenAI Chat Completions，只保存一个 safeStorage Key 和一个所选模型。

## 2. 当前产品事实

- L2 默认展示采购项目、合同、杂事三轨；Agent 模式只保留对话、临时思考/工具/审批状态与输入。权限、目录、自动化和会话管理只在 L3。
- L2/L3 共用 Agent store 与消息组件。进入或重新进入时定位最新消息；流式正文自动跟底。思考流只在当前 run 临时显示，正文开始后折叠，不落库、不进日志/搜索/记忆/导出。
- 合同允许信息不完整时先建草拟卡；卡片与 L3 显示合同号、供应商、金额、扫描件/附件/链接。合同可有多个节点，每个节点独立提醒。
- Agent 可检索主工作目录并运行一次性/每日/每周自动化；默认每日 09:00 生成会话和固定模板 PDF，无模型时确定性降级。
- 所有正式写入统一经过 AppCommand → AppService；飞书多维表格只单向同步采购项目。飞书机器人经长连接调用同一个 AgentService，不直接写库或调用本地 CLI。
- 飞书机器人设置提供六步可跳过向导、后台配置深链、实时连接徽章、配对倒计时与可选元数据诊断导出；远程发起的写操作即使桌面为 Bypass 也必须由该次 run 原发起人审批。

## 3. 关键实现入口

| 入口 | 职责 |
| --- | --- |
| `src/main/agentService.ts` | 唯一 run、事件、快照、会话编排 |
| `src/main/agentProviderConfigService.ts` | Provider、URL、模型与加密 Key 配置 |
| `src/main/piAgentAdapter.ts` | 流式 Provider 协议与工具循环 |
| `src/main/feishuAgentBridge.ts` | 飞书 Channel、配对、会话映射、进度/审批卡与防重 |
| `src/renderer/src/components/FeishuSetupWizard.tsx` / `FeishuAgentStatusBadge.tsx` | 六步接入向导、诊断深链、配对倒计时与 L2/L3 状态 |
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
- Peng 固定 `/v1` Base URL 与 Chat Completions；连接测试只发送固定“仅回复 OK”，模型目录使用 Bearer `GET /v1/models`。旧三个 Peng Provider ID 自动收敛且不改写共享密文。
- Peng 设置迁移保留已有 `peng_model`；缺失时优先沿用原激活模式的模型，再按 DeepSeek/OpenAI/Anthropic 旧设置顺序回退。旧模型设置保留但不再作为运行配置；模型列表相同不代表协议兼容已经通过，真实企业模型仍需测试新入口。
- 飞书 App Secret、配对码和消息正文不得进入日志；进度卡不得发送 thinking、原始工具结果或敏感路径。仅当前飞书 run 原发起人能操作审批/取消。

## 5. 修改与验收

- 测试只使用 faux/mock provider、隔离 SQLite、合成 Key 和系统临时目录，不读取真实任务、凭据或私人文件。
- Agent 变更覆盖文本、工具循环、思考分流、空响应、认证/限流/5xx、断流、超时、取消、序号补偿、重载与三档权限。
- 合同变更覆盖不完整草拟卡、金额精度、资料路径、多节点/提醒、状态机、事务回滚和并发冲突。
- 完成前执行 `npm run typecheck`、`npm test`、`npm run build`；发布相关改动再执行 `npm run package`，并按 `TEST_PLAN.md` 做安全与 Windows 验收。
- 当前候选的打包复现命令为 `npm run package -- --config.electronDist=node_modules/electron/dist`，本地 Electron 必须与项目版本一致。上述自动化记录不代表完成冷启动、常驻内存或完整 Windows 人工矩阵验收。
- 现有飞书链路已有公司环境成功经验，但 P31 候选仍需在真实企业沙箱回归：验证实际 Peng 单一入口与授权模型；验证六步向导、私聊、群内 `@机器人`、远程强制审批、桌面/飞书会话连续性，以及断网重连、重启、诊断导出和撤销用户。完成前保持 GitHub Release 为 prerelease，不能把 P31 标记为节点完成或正式生产版本。

## 6. 接手顺序与后续方向

先读 `AGENTS.md`，再按任务读取对应正式文档；开始前检查分支、工作区、最新提交和迁移。未经明确需求不要升级 Pi、放开网络/shell 边界或读取真实凭据。

候选增强统一记录在 `PLAN.md`；当前包括 OCR/旧 Office 提取、自定义排序与节点依赖、多显示器/Arm64、附件托管、数据库加密及经重新评估的飞书双向同步。
