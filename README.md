# 采办岛（Caiban Island）

Windows 10/11 顶部常驻的本地采购全流程与合同生命周期工作台。应用通过同一个透明窗口在 L1 隐藏条、L2 快速工作区和 L3 深度工作台之间展开，正式数据保存在本机 SQLite。

## 当前状态

`v0.4.0` 已完成，P0–P29 已验收。当前版本包括：

- L2 按采购项目、合同、杂事显示三条轨道，可切换至 Agent；L3 继续同一 Agent 会话。
- 采购项目支持正式全名/简称、版本化流程模板、采购方式、节点、deadline、提醒、资料和备注。
- 合同支持正式全名/简称、合同号、供应商、精确金额、扫描件绝对路径、附件、附属链接，以及付款/开票/交付/验收等多节点和逐节点提醒；信息不完整时也可先建立草拟卡片。一项目可关联多份合同，也可独立录入。
- 杂事保持名称、精确提醒、资料和备注的轻量模型。
- Pi Agent 可连接 DeepSeek 官方、智谱 GLM 或企业 OpenAI Chat Completions 兼容网关，并通过统一 AppCommand 原生查询和操作应用；企业模型 ID 可填写网关实际公布的 GPT、Claude、DeepSeek 等任意标识。支持三档权限、内联审批、后台运行与事件快照恢复。
- DeepSeek 工具参数保持顶层 object schema；无提醒时间保留为 `null`，避免对话创建卡片时被接口拒绝或产生空字符串时间。
- Agent 可维护一个本地主工作目录：增量索引 PDF、DOCX、XLSX、PPTX、Markdown、TXT 与 CSV，检索结果带来源定位；旧式 Office、图片、压缩包与无文本 PDF 只索引元数据。Agent 不提供任意 shell、任意网络或未授权路径访问。
- 默认每日 09:00 heartbeat 汇总逾期、今日与未来七日工作，生成 Agent 会话及本地 PDF；支持一次性、每日、每周自动化、睡眠/启动补跑、防重、总暂停和跨重启审批。模型不可用时仍生成确定性基础清单。
- Windows Toast、归档与恢复、Markdown/JSON/CSV 导出；飞书只单向同步采购项目，合同与杂事不外发。
- L3、归档、设置、记忆及非当前编辑器按需加载；首屏 renderer JS 由约 1.20 MB 降至 759 KB。L2 高度由轨道描述动态计算，样式拆为 shell、领域、合同与 Agent 层。
- Qoder MCP、STDIO 桥、旧内置 LLM 与专用 DraftService 已移除；遗留待处理草稿在 v12 升级时转换为通用提案。

## 运行与构建

```text
npm install
npm run dev
npm run typecheck
npm test
npm run build
npm run package
```

数据目录：`%APPDATA%\caiban-island\`。本地打包产物位于 `release/`；portable EXE 无代码签名，首次运行可能出现 SmartScreen 提示。

## Agent 配置

在 L3 → 设置 → Agent 中选择模型服务：DeepSeek 官方可选 Flash/Pro；智谱 GLM 可选开放平台或 Coding Plan 端点与预设模型；企业模型网关填写 HTTPS Base URL、网关公布的模型 ID 和企业 API Key。企业网关按 OpenAI Chat Completions 兼容协议请求，可用同一 Key 切换网关允许的不同模型。各 Provider 的 Key 分别只经 Electron safeStorage 加密保存；切换 Provider 不会删除其他 Key。未配置 Key 或离线时，手动任务功能仍完整可用。

权限模式：

- 每次写入确认：所有正式写入均需批准。
- 低风险自动写入：字段、节点、提醒、备注等可自动修改；创建、归档、删除、记忆和文件写入仍需批准。
- Bypass：在 AppCommand 与授权目录边界内自动执行；首次启用确认风险并持续显示警示。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| `AGENTS.md` | 工程、安全与按任务读取规则 |
| `docs/SPEC.md` | 当前产品行为 |
| `docs/ARCHITECTURE.md` | 当前模块、数据与接口边界 |
| `docs/DESIGN_SYSTEM.md` | 当前视觉、布局、输入与无障碍规则 |
| `docs/TEST_PLAN.md` | 当前测试与完成门禁 |
| `docs/PLAN.md` | 已完成基线与后续方向 |
| `docs/HANDOFF_PI_AGENT.md` | Agent 维护交接 |

根目录 `PRODUCT.md` 与 `DESIGN.md` 是供产品/设计工具快速载入的短摘要，不替代 `docs/` 中的正式规范。
