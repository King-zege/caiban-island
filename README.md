# 采办岛（Caiban Island）

屏幕顶部的"灵动岛"式采购任务管理工具：Windows 10/11 通用、免证书免安装、本地存储。

## 当前状态

**全部里程碑已完成（P0–P7）**：规划文档、窗口壳（L1/L2/L3 形变 + Acrylic 磨砂）、数据与卡片（SQLite/排序/滑动）、详情与时间轴（节点三态/链接/备注）、提醒与归档（Toast/快照/恢复）、AI 通道（Qoder MCP SSE + STDIO 桥接 + 内置 API + 草稿审核）、飞书多维表格同步、打包发布。

- 打包产物在 `release/`：`采办岛-便携版-0.1.0.exe`（免安装单文件）与 `采办岛-0.1.0-x64.zip`（绿色版，解压即用）；无证书，首次运行 SmartScreen 点"仍要运行"即可；
- 开发运行：`npm run dev`；构建：`npm run build` + `npm start`；
- 数据与快照：`%APPDATA%\caiban-island\`。
## 功能

- 顶部隐藏态提示条（96×6px 仅露约 4px），鼠标移上平滑展开为 L2 任务面板；L3 大面板完成详细编辑；
- 任务按紧急度排序，卡片显示名称、deadline、紧急度、进度、下一节点；触摸左右滑动浏览（惯性+吸附）；
- 详情含时间轴、节点三态（已完成=绿、进行中=蓝、待完成=黄）、网页 URL 与文件链接、Markdown 备注；
- 节点拆分：在 Qoder 中对话（官方 MCP 通道）→ 草稿回采办岛审核确认；另可配置内置 API 兜底通道；
- 到期 Windows 通知（无需证书）+ 岛内轻弹降级；任务完成/取消后全量归档（SQLite + Markdown/JSON 快照），可搜索查看与恢复；
- 黑色微磨砂质感、全圆角、弹簧动效；
- 飞书多维表格同步：个人令牌直连（免管理员审批），一键把任务（含节点/链接/备注）沉淀为多维表格记录，再次同步幂等更新；企业禁用令牌时用 CSV/Markdown 导出导入。

## 文档导航

| 文档 | 用途 |
| --- | --- |
| docs/SPEC.md | 产品行为与验收标准 |
| docs/ARCHITECTURE.md | 技术栈、模块边界、数据模型、MCP 契约 |
| docs/DESIGN_SYSTEM.md | 尺寸、材质、圆角、颜色、动效与无障碍 |
| docs/TEST_PLAN.md | 各节点测试机制与验收矩阵 |
| docs/PLAN.md | 决策记录、里程碑、风险 |
| AGENTS.md | Agent 与贡献者工程规则 |

冲突优先级：SPEC（行为）> ARCHITECTURE（技术）> DESIGN_SYSTEM（视觉）> TEST_PLAN（验收）；工程底线见 AGENTS.md。

## Qoder MCP 配置（P5 起可用）

**方式一（推荐）：SSE**

1. 启动采办岛，打开 L3 → 设置 → Qoder MCP；
2. 复制 SSE 地址（形如 http://127.0.0.1:端口/sse?token=令牌）；
3. 打开 Qoder 独立桌面 IDE → 个人设置 → MCP 服务 → 添加 → 类型选 SSE → 粘贴地址；
4. 在 Qoder 智能体模式下对话，例如："帮我把《XX设备采购》拆成时间节点"；
5. 草稿出现在采办岛 L3 的 AI 草稿审核中，逐节点保留/删除/修改/排序后确认，即可生成任务卡片。

**方式二（备用）：STDIO**

设置页提供 node 桥接命令（node "<应用目录>/scripts/caiban-stdio.mjs"），在 Qoder 的 MCP 服务中选择 STDIO 类型并粘贴该命令；桥接脚本会自动拉起采办岛并把 stdio 转发到 SSE 端点。

内置 AI 兜底通道：设置 → 内置 AI 配置任意 OpenAI 兼容 API（Base URL/模型/Key），即可在 AI 草稿审核页直接"用 AI 拆解"。

## 免证书绿色版与 SmartScreen

发布物为绿色免安装 zip，解压后双击 采办岛.exe 即可运行；无需证书、无需安装。首次运行 Windows SmartScreen 可能提示"Windows 已保护你的电脑"，点击"更多信息 → 仍要运行"即可——这是无签名应用的正常现象，不是病毒。数据保存在 %APPDATA%\caiban-island\，删除该目录即清除全部数据。

## 飞书多维表格同步（P6 已完成）

1. 在飞书多维表格中打开"开发者"入口，生成个人令牌（PersonalBaseToken，无需企业管理员审批），粘贴到采办岛 L3 → 设置 → 飞书多维表格同步；
2. 点"测试连接"，成功后点"同步到飞书"：应用会自动创建多维表格"采办岛任务"（含 13 个字段的数据表）并写入全部活跃任务；
3. 再次同步按"采办岛任务ID"幂等更新对应行，不重复插入；
4. 可打开"任务变更后自动同步"（防抖 3 秒）；
5. 令牌失效等错误会给出明确提示；
6. 兜底导出：设置页可一键导出 CSV（UTF-8 BOM）或 Markdown 到数据目录 export\，飞书多维表格中"导入"即可（无令牌也能用）。

## 开发命令（P1 起生效）

    npm install
    npm run dev
    npm run typecheck
    npm test
    npm run build
    npm run package   # P7 起

开发流程：按 docs/PLAN.md 里程碑推进，每个节点完成后执行该节点的测试机制（见 docs/TEST_PLAN.md），全部通过后做一次 git commit。