# Product

<!-- impeccable:product-schema 1 -->

## Platform

Windows 10/11 桌面应用。

## Users

需要在浏览器、文档、沟通工具和采购资料之间频繁切换的个人采购执行者。

## Product Purpose

采办岛以 L1 隐藏入口、L2 快速工作区和 L3 深度工作台降低任务切换成本。L2 应在数秒内回答“下一步做什么”，L3 负责安全维护完整记录；Agent 是应用的原生操作接口，不是独立 AI 草稿系统。

## Positioning

独特机制是同一个顶部置顶窗口在 L1/L2/L3 间连续展开，并让采购链路与 Agent 会话保持上下文，而不是切换到独立项目后台。

## Operating Context

- 采购项目：正式全名、卡片简称、采购方式、版本化流程、deadline、节点、提醒、资料和备注。
- 合同：正式全名、简称、供应商、合同号、精确金额、生命周期、付款/开票/交付/验收等履约动作和提醒。
- 杂事：名称、一次精确提醒、资料和备注；无紧急度、deadline 或节点。
- L2 默认任务卡片，可切换 Agent；L2/L3 共用同一 Agent 会话与权限状态。
- 正式数据以本地 SQLite 为准；归档生成可读快照；飞书只做单向导出。
- Agent 通过 AppCommand、三档权限和授权目录操作应用；可检索主工作目录并运行结构化自动化，但无任意 shell、网络或未授权磁盘权限。
- 默认每日 09:00 heartbeat 生成采购、合同和杂事清单会话及固定模板 PDF；无模型时确定性降级。

## Capabilities and Constraints

- renderer 只经 preload IPC 使用 main 能力；本地 SQLite 是正式数据源。
- Agent 无任意 shell、额外网络或未授权磁盘权限；正式操作受 AppCommand 与三档权限约束。
- 当前不包含多人审批、供应商门户、OCR、飞书双向同步或模型权重训练。

## Brand Commitments

- 产品名为“采办岛”；中文文案直接、克制，不暴露内部需求编号。
- 三级注意力模型、采购凭条/工作单和节点链路是产品识别特征。

## Evidence on Hand

产品、架构、设计与测试契约位于 `docs/`，当前 Electron/React 实现位于 `src/`。仓库没有可用于宣传的客户、成效指标或第三方背书。

## Product Principles

1. 下一动作优先于功能入口。
2. 常驻但不打扰，展开与返回可预测。
3. 正式写入有清晰权限、结果反馈与并发保护。
4. 高级集成按需出现，手动模式始终可用。
5. 本地数据、凭据与用户文件优先保证安全可控。

## Accessibility & Inclusion

所有核心流程支持键盘与读屏；目标不小于 44×44px；正文与控件满足 WCAG AA；高对比度、减少动画和不同 DPI 下可靠降级。

详细行为以 `docs/SPEC.md` 为准。
