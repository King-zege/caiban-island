# AGENTS.md

本文件适用于整个仓库。任何 agent 或贡献者开工前应先阅读本文件与相关 docs/ 文档。

## 1. 文档优先级与工作方式

1. 产品行为以 docs/SPEC.md 为准；
2. 模块、数据与接口以 docs/ARCHITECTURE.md 为准；
3. 视觉、输入与无障碍参数以 docs/DESIGN_SYSTEM.md 为准；
4. 验证方法与完成标准以 docs/TEST_PLAN.md 为准；
5. 本文件定义跨模块的工程与安全底线。

发现文档冲突、缺失行为或不可实施标准时，不得自行选择一种解释后继续：先记录冲突、更新相关文档使其一致，再实现代码与测试。

## 2. 节点完成门禁（Definition of Done）

- 开发按 docs/PLAN.md 里程碑（节点 P0–P7）推进；
- 每个节点完成后必须：
  1. 执行该节点的测试机制（docs/TEST_PLAN.md 第 1 节映射表：自动化测试 + 手工验收清单）；
  2. 全部通过后，执行一次 git commit，提交信息格式为 "P{n}: <节点名> — 测试与验收通过"，内容仅含本节点变更；
  3. 测试未通过禁止提交"节点完成"；先修复，再重跑测试，再提交。
- 节点内的缺陷修复属于该节点提交的一部分；禁止把未通过验收的半成品当作节点完成提交。

## 3. 不可违反的架构边界

- renderer 不得直接访问 Node API、SQLite、文件系统或 HTTP；一切经 preload 白名单 IPC。
- main 进程独占数据库、文件、网络、窗口与系统集成；业务规则（校验、排序、进度）放 shared/main 服务层，UI 不复制业务验证。
- shared 不得引用 Electron 或渲染层依赖。
- 任何 AI 输出（Qoder MCP 或内置 API）永远是草稿；只有用户确认后的应用服务事务能创建/修改正式数据。
- SQLite schema 变更必须使用版本化迁移；禁止启动时执行未版本化 DDL。
- 行为或公共契约变化必须在同一改动中更新对应文档与测试。
- 飞书同步仅单向导出（岛 → 多维表格），以岛内数据为准；禁止从表格回写本地正式数据。

## 4. 安全与隐私底线

- API Key 仅经 safeStorage 加密保存；禁止进入 SQLite 明文、日志、快照、备份、测试夹具与源代码。
- MCP 服务只绑定 127.0.0.1 并校验 token；日志只记录工具名、耗时、成功/失败类别，禁止完整请求正文与 Authorization header。
- Markdown 渲染禁用原始 HTML/脚本；外部链接打开前显示实际目标。
- 禁止记录用户文件内容与敏感绝对路径（日志脱敏为类别）。
- PersonalBaseToken 与 API Key 同级待遇：safeStorage 加密保存，禁止进入日志、快照、备份、测试夹具与源代码。
- 测试不得使用真实 API Key、真实 MCP token、PersonalBaseToken 或私人文件。

## 5. 编码与依赖规则

- TypeScript strict；禁止 any（确有需要时注明理由）；警告按错误处理。
- 设计 token 一律引用 shared 中的 token 常量，禁止硬编码颜色/圆角/间距魔法数字。
- 组件组织：renderer/src/components（通用）、panels（L2/L3 面板）、state（Zustand store）。
- 时间使用 ISO8601 UTC 存储 + 时区换算展示（shared/time）。
- ID 使用 GUID；排序必须有稳定 tie-breaker。
- 新增第三方依赖前检查许可证与维护状态，并在 ARCHITECTURE.md 记录用途。
- 异步 I/O 使用 async/await，公共函数接收取消信号（AbortSignal），用于收起/超时场景。

## 6. Windows 特有注意事项（必读）

- 透明窗口：BrowserWindow(frame:false, transparent:true, alwaysOnTop:true, skipTaskbar:true, hasShadow:false)；置顶层级用 screen-saver 级别，但不得挡住真正全屏应用（P7 检测）。
- 点击穿透：折叠态用 setIgnoreMouseEvents(true, {forward:true}) 配合屏幕坐标轮询热区；禁止大范围透明覆盖窗口吞掉下层点击。
- 磨砂：koffi 调用 SetWindowCompositionAttribute（ACCENT_ENABLE_ACRYLICBLURBEHIND，失败级联 BLURBEHIND）；HWND 必须从 getNativeWindowHandle() 的 Buffer 读出数值按 int64 传参（把 Buffer 当指针会静默失败）；全部失败回退纯色 #111216；高对比度/减少动画时关闭。
- MCP/stdio：Windows GUI 子系统程序（Electron 打包的 exe）没有可用 stdio 管道，无法直接做 STDIO MCP 服务；使用 scripts/caiban-stdio.mjs（Node）桥接到 GUI 的 SSE 端点。MCP Server 实例只能连接一个传输，多会话须各自 new Server；"创建会话"请求才校验 token（sessionId 即会话凭据）。
- DPI：per-monitor 感知；所有窗口尺寸用逻辑像素并做显示器换算。
- 通知：app.setAppUserModelId 并确保开始菜单快捷方式存在（Win10 图标显示所需）；无证书不影响 Toast。
- 单实例：app.requestSingleInstanceLock；二次启动时唤起已运行实例。
- 打包：electron-builder portable；无签名；SmartScreen 属正常现象，勿尝试绕过。

## 7. 提交前门禁（P1 起生效，每个节点完成时执行）

    npm run typecheck
    npm test           # 全部通过
    npm run build      # 成功
    npm run package    # P7 起

P0 阶段以上命令随 P1 建立；P0 的门禁是文档一致性检查（相对链接可达、标题结构、术语一致、SPEC 覆盖全部需求）。提交前检查 git diff，确认无凭据、无私人路径、无无关改动。

## 8. 推荐实现顺序

按 docs/PLAN.md 里程碑顺序执行，不跨节点混做；每个节点结束时先跑该节点测试机制，通过后提交，再进入下一节点。
