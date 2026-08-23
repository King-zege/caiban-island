# 采办岛（Caiban Island）

屏幕顶部的"灵动岛"式采购任务管理工具：Windows 10/11 通用、免证书免安装、本地存储。

## 当前状态

**v0.2.0，已完成至 P13**：在完整采购任务能力之上，界面已重构为“精密采购工作台”，三级切换采用单次原生 resize；MCP 凭据已改为系统加密存储，草稿在编辑与确认时会再次校验。Pi Agent 原生集成将在 P14–P15 提供。

- GitHub Release 只提供一个推荐下载：`Caiban-Island-0.2.0-Windows-x64.exe`（Windows x64 免安装独立运行版）；本地 `release/` 仍会生成同名 ZIP 用于打包验收，不上传 Release；
- 开发运行：`npm run dev`；构建：`npm run build` + `npm start`；
- 数据与快照：`%APPDATA%\caiban-island\`。
## 功能

- 顶部隐藏态提示条只露 4–6px且圆角朝向屏幕中心，鼠标停留后展开为 L2 横向采购凭条；鼠标离开 L2 自动收起；
- L2 以任务名为主标题、下一节点为副标题，并提供上一/当前/下一节点轴、四态显式选择和卡片任务菜单；
- L3 使用 240px 任务栏和单任务工作台，概览、采购节点、资料、提醒、备注一次只显示一个主分区；
- 节点状态支持待完成、进行中、已完成、已取消四态显式选择；节点、资料与任务永久删除延迟 5 秒提交并支持撤销；
- 节点拆分：在 Qoder 中对话或使用内置 AI，输出统一进入草稿审核，确认后才写入正式任务；
- 到期 Windows 通知（无需证书）+ 岛内轻弹降级；任务完成/取消后全量归档（SQLite + Markdown/JSON 快照），可搜索查看与恢复；
- 系统明暗、高对比度与减少动画实时跟随；外链打开前确认完整目标；连接地址和会话凭据默认遮罩；
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

1. 启动采办岛，打开 L3 → 设置 → AI 与 Qoder；
2. 在“Qoder 连接”中明确选择“复制地址”；连接地址与会话凭据默认遮罩；
3. 打开 Qoder 独立桌面 IDE → 个人设置 → MCP 服务 → 添加 → 类型选 SSE → 粘贴地址；
4. 在 Qoder 智能体模式下对话，例如："帮我把《XX设备采购》拆成时间节点"；
5. 草稿出现在采办岛 L3 的 AI 草稿审核中，逐节点保留/删除/修改/排序后确认，即可生成任务卡片。

**方式二（备用）：STDIO**

在“高级：手动连接 Qoder”中明确复制备用命令，再在 Qoder 的 MCP 服务中选择 STDIO 类型并粘贴。桥接脚本会自动拉起采办岛并把 stdio 转发到 SSE 端点。

内置 AI 兜底通道：设置 → AI 与 Qoder → 内置 AI，配置兼容服务地址、模型和访问密钥，即可在 AI 草稿页生成待审核节点。

## Windows 独立运行版与 SmartScreen

从 GitHub Release 下载 `Caiban-Island-0.2.0-Windows-x64.exe` 后可直接运行，无需安装。当前版本未购买代码签名证书，首次运行 Windows SmartScreen 可能提示"Windows 已保护你的电脑"；核对发布页与文件名后，可点击"更多信息 → 仍要运行"。数据保存在 %APPDATA%\caiban-island\，删除该目录即清除全部数据。

## 飞书多维表格同步（P6 已完成）

1. 在飞书多维表格中打开"开发者"入口，生成个人令牌（PersonalBaseToken，无需企业管理员审批），粘贴到采办岛 L3 → 设置 → 飞书同步；
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
