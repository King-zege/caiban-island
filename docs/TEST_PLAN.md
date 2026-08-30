# 采办岛当前测试计划

历史 P0–P21 的逐节点记录不再常驻本文；当前完成标准以受影响测试、全量门禁和下列矩阵为准。

## 1. 变更 → 验证范围

| 变更类型 | 必须验证 |
| --- | --- |
| shared 纯逻辑、schema、排序、时间 | 对应单测 + typecheck |
| AppService、SQLite、迁移、提醒、归档 | 单元/集成、事务回滚、旧库升级与幂等 |
| Agent、权限、AppCommand、文件、CLI | faux provider 工具循环、审批/Bypass、schema、路径和回环安全 |
| renderer UI/状态 | Testing Library 交互、焦点/键盘、axe、L2/L3 状态连续性 |
| 窗口、动效、DPI、主题 | 状态机/几何测试、隔离 Electron 截图与性能基准、Windows 人工矩阵 |
| 依赖、构建、分发 | typecheck、全量测试、build、package、ASAR/portable 冒烟和许可证检查 |

节点或发布完成门禁：

```text
npm run typecheck
npm test
npm run build
npm run package
```

失败不得提交完成；修复后重跑受影响测试及上述门禁。视觉 detector 的执行次数和处理结果按当前任务要求记录。

## 2. 自动化覆盖

- 任务：字段校验、项目/杂事约束、紧急度与稳定排序、进度、名称/时间旧值冲突。
- SQLite：CRUD、WAL、外键级联、v1–v9 迁移、双名称回填、旧草稿转提案、失败回滚与重复启动幂等。
- 合同：一项目多合同/独立合同、整数最小货币单位、状态机、稳定动作排序、付款—开票关联、并发冲突与归档恢复。
- 提醒：项目提前量、节点/合同动作/杂事精确时间、原子领取、时间修改、生命周期取消/恢复、睡眠漏发合并。
- 归档/导出：完成/取消、Markdown/JSON 往返、恢复、同名保护、CSV/飞书字段映射。
- 安全内容：Markdown raw HTML/script/iframe 拒绝；外链与文件目标确认。
- AppCommand：完整 schema、坏枚举、缺失/多余字段、风险、预期旧值、摘要与撤销元数据。
- 权限：三种模式跨重启、Bypass 首次确认/警示、批准/拒绝/取消、重复确认、未知工具 fail-closed。
- 文件/CLI：回环鉴权、Content-Type/体积、非法命令、`..`、设备/UNC、符号链接/联接、未授权相邻目录、移动与单文件删除。
- Pi/DeepSeek：文本、工具调用、空响应、异常终止、401、429、5xx、断流、超时、取消、12 轮上限；逐工具验证顶层 object schema，并在 DeepSeek 最终 HTTP payload 层断言 `execute_app_command`；自动化不得使用真实 Key。
- 会话/记忆：事件序号与快照补偿、早到/丢失/重载、可见消息持久化、FTS5、记忆容量/证据/安全扫描。
- Renderer：L2 默认卡片、采购/合同/杂事三轨、L3 合同六分区、双名称与跨域搜索、L2/L3 Agent 功能一致、审批差异卡、错误重试、会话管理、通知导航、键盘与焦点恢复。
- 窗口：L1 可见区、点击穿透、过渡阶段、旧 transition id、单次 resize、composited/software/direct、虚拟卡片 ≤7。

## 3. Agent 隔离端到端

使用系统临时目录、隔离 SQLite、合成任务/文件和 faux provider 驱动真实 Pi 工具循环：

1. 从 L2 Agent 发起并展开 L3，验证同一会话、流文本、工具和权限状态。
2. 创建一个采购项目和一个杂事；核对 L2 凭条/工作单、SQLite 和审计事件。
3. 修改名称、紧急度、备注、提醒、节点、状态和排序；核对提醒派生状态。
4. 验证确认模式与 Bypass 下删除合成卡片的差异。
5. 授权临时目录，创建分类目录并重命名/移动合成文件；断言相邻未授权目录不变。
6. 切回 L2 Agent，确认会话与工具结果完整；保存脱敏截图/结果清单后仅清理隔离数据。

不得读取真实任务、私人文件、API Key、PersonalBaseToken 或本地命令令牌。

## 4. Windows 人工矩阵

- 系统：Win10 1809/22H2、Win11；DPI 100/125/150%，含混合缩放。
- 输入：鼠标悬停/拖动/滚轮、触摸滑动、纯键盘、读屏。
- 窗口：浏览器最大化不遮挡；真正全屏退让；单实例；托盘；开机自启；通知点击定位。
- 外观：深色、浅色、高对比度、减少动画、Acrylic 失败回退、200% 文本。
- 内容：每轨 0/1/7/100 数据、采购/合同/杂事任意组合、长中文、逾期、无节点/无履约动作、通用提案、归档、离线和凭据遮罩。
- Agent：后台继续、显式取消、慢首包、错误重试、审批焦点、Bypass 警示、L2/L3 连续与 L3 无“AI 草稿”。

## 5. 性能门禁

- 冷启动目标 <2s，常驻内存目标 <250MB；100 个活跃任务滚动与排序无明显卡顿。
- 每次层级切换最多一次 resize；首个视觉帧 ≤50ms；composited 视觉过渡 200±40ms。
- 100 任务 animating 阶段无 >50ms 帧，>20ms 帧比例 <5%，无 >50ms Long Task；L2 DOM ≤700，实际 TaskCard ≤7。
- 使用 `npm run benchmark:transitions -- <CDP端口> --assert`；Electron 必须连接系统临时目录中的 100 条合成任务，推荐使用生产构建而非 dev server。

## 6. 安全与打包

- 提交前扫描源码、测试、SQLite、日志、导出与包：无真实凭据、Authorization、reasoning、私人绝对路径或用户文件正文。
- 日志只含命令/工具名、阶段、耗时、权限决策与错误类别。
- 包内必须含 Pi ESM 运行依赖、DeepSeek lazy provider、`caiban-cli.mjs` 与第三方声明；不得含本应用旧 MCP/LLM/stdio 文件或 Pi CJS `require`。
- portable/zip 时间戳与哈希属于发布产物记录，不写入长期规范。SmartScreen 行为应与 README 说明一致。
