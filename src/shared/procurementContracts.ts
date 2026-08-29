import type { NodeInput, ProcurementProject, Urgency } from './taskContracts';

export type ProcurementMethod = 'open_tender' | 'invited_tender' | 'competitive_negotiation' | 'single_source' | 'inquiry' | 'framework' | 'custom';
export type ProcurementNodeSource = 'template' | 'agent' | 'custom';

export interface ProcurementWorkflowStage {
  key: string;
  title: string;
  description: string;
}

export interface ProcurementWorkflowTemplate {
  id: string;
  version: number;
  name: string;
  description: string;
  stages: ProcurementWorkflowStage[];
}

export interface ProcurementPlanNode extends NodeInput {
  stageKey?: string | null;
  source?: ProcurementNodeSource;
}

export interface ProcurementProjectCreateRequest {
  fullName: string;
  shortName: string;
  description: string;
  urgency: Urgency;
  deadlineUtc: string | null;
  tzId: string;
  procurementMethod: ProcurementMethod;
  templateId: string | null;
  nodes?: ProcurementPlanNode[];
}

export interface ProcurementPlanApplyRequest {
  taskId: string;
  templateId: string | null;
  templateVersion: number | null;
  procurementMethod: ProcurementMethod;
  nodes: ProcurementPlanNode[];
  expectedUpdatedAtUtc: string;
}

export interface ProcurementProjectCreateResult {
  project: ProcurementProject;
  nodeCount: number;
}

export const PROCUREMENT_METHOD_LABELS: Record<ProcurementMethod, string> = {
  open_tender: '公开招标',
  invited_tender: '邀请招标',
  competitive_negotiation: '竞争性谈判',
  single_source: '单一来源',
  inquiry: '询价采购',
  framework: '框架采购',
  custom: '自定义'
};

export const PROCUREMENT_WORKFLOW_TEMPLATES: readonly ProcurementWorkflowTemplate[] = [
  {
    id: 'standard-procurement',
    version: 1,
    name: '标准采购全流程',
    description: '从申请受理到合同签署的十阶段通用流程，可在创建后继续调整。',
    stages: [
      { key: 'request', title: '申请受理', description: '确认采购需求、预算、范围和发起资料。' },
      { key: 'strategy', title: '立项 / 采购策略', description: '完成立项并明确采购方式、评审办法与时间计划。' },
      { key: 'sourcing', title: '供应商寻源', description: '识别、预审并形成候选供应商清单。' },
      { key: 'solicitation', title: '采购文件 / 邀约', description: '编制、审核并发布采购文件或邀请。' },
      { key: 'submission_deadline', title: '截标', description: '完成收件、密封性或电子递交状态确认。' },
      { key: 'opening', title: '开标', description: '按程序组织开标并记录结果。' },
      { key: 'evaluation', title: '评审定标', description: '完成评审、澄清、推荐与定标审批。' },
      { key: 'award_notice', title: '结果通知', description: '发出成交/中标及未成交结果通知。' },
      { key: 'contract_drafting', title: '合同起草', description: '完成条款谈判、法务及业务审核。' },
      { key: 'contract_signing', title: '合同签署', description: '完成签章、生效资料与合同移交。' }
    ]
  }
] as const;

export function getProcurementTemplate(id: string): ProcurementWorkflowTemplate {
  const template = PROCUREMENT_WORKFLOW_TEMPLATES.find((entry) => entry.id === id);
  if (!template) throw new Error('采购流程模板不存在');
  return template;
}

export function instantiateProcurementTemplate(id: string, deadlineUtc: string | null): ProcurementPlanNode[] {
  const template = getProcurementTemplate(id);
  return template.stages.map((stage, index) => ({
    title: stage.title,
    description: stage.description,
    startUtc: null,
    endUtc: index === template.stages.length - 1 ? deadlineUtc : null,
    stageKey: stage.key,
    source: 'template'
  }));
}
