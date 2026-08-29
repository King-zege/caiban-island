# AGENTS.md

本文件适用于整个仓库，定义长期有效的工程与安全底线。不要把历史里程碑、验收日志或实现快照继续堆入本文件。

## 1. 按任务读取文档

- 所有任务：先读本文件；需要项目概览时读 `README.md`。
- 产品行为：`docs/SPEC.md`。
- 模块、数据、IPC、Agent 或 CLI：`docs/ARCHITECTURE.md`。
- UI、动效、输入、无障碍：`docs/DESIGN_SYSTEM.md`；根目录 `DESIGN.md` 仅是短摘要。
- 测试与完成标准：`docs/TEST_PLAN.md`。
- 路线图或新节点：`docs/PLAN.md`。
- Agent 维护或交接：`docs/HANDOFF_PI_AGENT.md`。

无需为局部任务读取全部文档。冲突优先级为 SPEC → ARCHITECTURE → DESIGN_SYSTEM → TEST_PLAN；先消除冲突，再改代码。

## 2. 完成与提交

- 行为、公共契约或 schema 变化必须同步更新相关文档与测试。
- 节点完成前执行 `npm run typecheck`、`npm test`、`npm run build`；P7 起及发布相关改动还要执行 `npm run package`。
- 测试或人工验收未通过，不得提交“节点完成”。节点提交格式：`P{n}: <节点名> — 测试与验收通过`。
- 提交前检查 diff，排除凭据、私人路径、生成物和无关改动。

## 3. 架构边界

- renderer 不直接访问 Node、SQLite、文件系统或 HTTP，只经 preload 白名单 IPC。
- main 独占数据库、文件、网络、窗口和系统集成；业务校验与事务放 shared/main，UI 不复制规则。
- shared 不引用 Electron 或 renderer。
- 正式数据写入统一经 `AppCommand` → `AppService`；renderer、Agent 与 CLI 不得绕过。
- SQLite 变更必须新增版本化迁移；飞书仅允许“本地 → 多维表格”单向导出。

## 4. Agent 与安全

- Agent 权限只有“每次写入确认 / 低风险自动写入 / Bypass”。Bypass 也不能越过 AppCommand、授权目录、受限 CLI、safeStorage、本地回环和无任意 shell/网络边界。
- API Key、PersonalBaseToken、本地命令令牌只经 safeStorage 加密保存；不得进入日志、SQLite 明文、快照、备份、导出、测试夹具或源码。
- 本地命令端点只绑定 `127.0.0.1`；日志仅记录命令/工具名、阶段、耗时、权限决策和错误类别。
- 自动化只使用 faux/mock provider、合成数据和系统临时目录；不得读取真实凭据、正式任务或私人文件。
- Markdown 禁用原始 HTML/脚本；外链打开前展示实际目标；日志不得记录文件正文或敏感绝对路径。

## 5. 编码与 Windows 约束

- TypeScript strict，禁止无理由 `any`；异步 I/O 使用 async/await，长操作接受 `AbortSignal`。
- 设计值引用 `src/shared/designTokens.ts`；时间存 ISO8601 UTC，展示按时区转换；ID 用 GUID，排序必须稳定。
- 透明置顶窗口、点击穿透、Acrylic 回退、per-monitor DPI、全屏退让、单实例与通知行为必须保持现有边界。
- `scripts/caiban-cli.mjs` 只连接 GUI 的回环 AppCommand 端点，禁止转发 PowerShell/CMD、任意 URL 或未授权路径。
- 打包使用 electron-builder portable；无签名导致的 SmartScreen 提示是正常分发限制，不得绕过。
