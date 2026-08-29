import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { useState } from 'react';
import type { TaskCreateRequest, TaskKind, Urgency } from '../../../shared/types';
import { PROCUREMENT_METHOD_LABELS, PROCUREMENT_WORKFLOW_TEMPLATES } from '../../../shared/procurementContracts';
import type { ProcurementMethod } from '../../../shared/procurementContracts';
import { KINDS, URGENCIES } from '../../../shared/taskContracts';
import { useTaskStore } from '../state/useStore';
import { useWorkspaceStore } from '../state/useWorkspaceStore';
import { AsyncFeedback } from './ui/AsyncFeedback';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Field } from './ui/Field';

const URGENCY_LABEL: Record<Urgency, string> = { critical: '紧急', high: '高', normal: '普通', low: '低' };
const KIND_LABEL: Record<TaskKind, string> = { procurement: '采购项目', misc: '杂事' };

export default function NewTaskForm({ onClose }: { onClose: () => void }): React.JSX.Element {
  const create = useTaskStore((state) => state.create);
  const createProcurement = useTaskStore((state) => state.createProcurement);
  const notify = useWorkspaceStore((state) => state.notify);
  const [fullName, setFullName] = useState('');
  const [shortName, setShortName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<TaskKind>('procurement');
  const [urgency, setUrgency] = useState<Urgency>('normal');
  const [procurementMethod, setProcurementMethod] = useState<ProcurementMethod>('open_tender');
  const [templateId, setTemplateId] = useState<string | null>('standard-procurement');
  const [deadlineText, setDeadlineText] = useState('');
  const [reminderText, setReminderText] = useState('');
  const [note, setNote] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving || fullName.trim().length === 0 || (kind === 'procurement' && shortName.trim().length === 0)) return;
    setSaving(true);
    setError(null);
    let timeUtc: string | null = null;
    try {
      const value = kind === 'misc' ? reminderText : deadlineText;
      timeUtc = value ? new Date(value).toISOString() : null;
    } catch {
      setSaving(false);
      setError((kind === 'misc' ? '提醒' : '截止') + '时间格式无效，请重新选择');
      return;
    }
    const tzId = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const result = kind === 'misc'
      ? await create({ kind: 'misc', name: fullName, note, remindAtUtc: timeUtc, tzId } satisfies TaskCreateRequest)
      : await createProcurement({ fullName, shortName, description, urgency, deadlineUtc: timeUtc, tzId, procurementMethod, templateId });
    setSaving(false);
    if (result) {
      setError(result);
      return;
    }
    notify(kind === 'misc' ? '杂事已创建' : '采购项目已创建', 'success');
    onClose();
  };

  return (
    <Dialog
      open
      title="新建"
      description="先选择工作类型，界面只保留这类工作需要的信息。"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" disabled={saving} onClick={onClose}>取消</Button>
          <Button icon={Plus} variant="primary" disabled={saving || fullName.trim().length === 0 || (kind === 'procurement' && shortName.trim().length === 0)} onClick={() => void save()}>
            {saving ? '正在创建' : kind === 'misc' ? '创建杂事' : '创建项目'}
          </Button>
        </>
      }
    >
      <div className="new-task-form">
        <div className="ui-field">
          <span className="ui-field-label">工作类型</span>
          <span className="segmented-control" role="group" aria-label="工作类型">
            {KINDS.map((value) => <button type="button" key={value} aria-pressed={kind === value} className={kind === value ? 'active' : ''} onClick={() => setKind(value)}>{KIND_LABEL[value]}</button>)}
          </span>
        </div>
        <Field
          label={kind === 'misc' ? '杂事名称' : '项目正式名称'}
          value={fullName}
          autoFocus
          placeholder={kind === 'misc' ? '例如：联系物业续门禁卡' : '例如：2026 年度总部办公电脑框架协议采购项目'}
          maxLength={kind === 'misc' ? 200 : 500}
          onChange={(event) => setFullName(event.target.value)}
        />
        {kind === 'procurement' && <Field
          label="卡片简称"
          value={shortName}
          hint="最多 24 个字符，用于 L2 凭条"
          placeholder="例如：总部电脑框采"
          maxLength={24}
          onChange={(event) => setShortName(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !expanded) void save(); }}
        />}
        {kind === 'misc' ? (
          <div className="new-task-extra">
            <Field label="提醒时间" type="datetime-local" value={reminderText} hint="不设置就不会提醒" onChange={(event) => setReminderText(event.target.value)} />
            <label className="ui-field">
              <span className="ui-field-label">备注</span>
              <textarea value={note} maxLength={4000} placeholder="记录需要记住的信息，可稍后添加链接或文件" onChange={(event) => setNote(event.target.value)} />
            </label>
          </div>
        ) : <>
          <Button icon={expanded ? ChevronUp : ChevronDown} variant="ghost" className="disclosure-button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
            {expanded ? '收起补充信息' : '补充截止时间、优先级与说明'}
          </Button>
          {expanded && (
          <div className="new-task-extra">
            <label className="ui-field">
              <span className="ui-field-label">采购方式</span>
              <span className="ui-field-control">
                <select value={procurementMethod} onChange={(event) => setProcurementMethod(event.target.value as ProcurementMethod)}>
                  {Object.entries(PROCUREMENT_METHOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </span>
            </label>
            <label className="ui-field">
              <span className="ui-field-label">流程模板</span>
              <span className="ui-field-control">
                <select value={templateId ?? ''} onChange={(event) => setTemplateId(event.target.value || null)}>
                  {PROCUREMENT_WORKFLOW_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.name} · v{template.version}</option>)}
                  <option value="">空白流程（自行添加节点）</option>
                </select>
              </span>
              <span className="ui-field-hint">模板只在创建时复制，后续升级不会静默修改既有项目</span>
            </label>
            <div className="ui-field">
              <span className="ui-field-label">紧急程度</span>
              <span className="segmented-control" role="group" aria-label="紧急程度">
                {URGENCIES.map((value) => <button type="button" key={value} aria-pressed={urgency === value} className={'urgency-' + value + (urgency === value ? ' active' : '')} onClick={() => setUrgency(value)}>{URGENCY_LABEL[value]}</button>)}
              </span>
            </div>
            <Field label="截止时间" type="datetime-local" value={deadlineText} onChange={(event) => setDeadlineText(event.target.value)} />
            <label className="ui-field">
              <span className="ui-field-label">任务说明</span>
              <textarea value={description} maxLength={1000} placeholder="记录范围、目标或需要特别留意的事项" onChange={(event) => setDescription(event.target.value)} />
            </label>
          </div>
          )}
        </>}
        {error && <AsyncFeedback tone="error" message={error} onRetry={() => void save()} />}
      </div>
    </Dialog>
  );
}
