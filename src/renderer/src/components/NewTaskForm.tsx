import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { useState } from 'react';
import type { TaskInput, TaskKind, Urgency } from '../../../shared/types';
import { KINDS, URGENCIES } from '../../../shared/taskContracts';
import { useTaskStore } from '../state/useStore';
import { useWorkspaceStore } from '../state/useWorkspaceStore';
import { AsyncFeedback } from './ui/AsyncFeedback';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Field } from './ui/Field';

const URGENCY_LABEL: Record<Urgency, string> = { critical: '紧急', high: '高', normal: '普通', low: '低' };
const KIND_LABEL: Record<TaskKind, string> = { task: '采购任务', misc: '其他事项' };

export default function NewTaskForm({ onClose }: { onClose: () => void }): React.JSX.Element {
  const create = useTaskStore((state) => state.create);
  const notify = useWorkspaceStore((state) => state.notify);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<TaskKind>('task');
  const [urgency, setUrgency] = useState<Urgency>('normal');
  const [deadlineText, setDeadlineText] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving || name.trim().length === 0) return;
    setSaving(true);
    setError(null);
    let deadlineUtc: string | null = null;
    try {
      deadlineUtc = deadlineText ? new Date(deadlineText).toISOString() : null;
    } catch {
      setSaving(false);
      setError('截止时间格式无效，请重新选择');
      return;
    }
    const input: TaskInput = {
      name,
      description,
      kind,
      urgency,
      deadlineUtc,
      tzId: Intl.DateTimeFormat().resolvedOptions().timeZone
    };
    const result = await create(input);
    setSaving(false);
    if (result) {
      setError(result);
      return;
    }
    notify('任务已创建', 'success');
    onClose();
  };

  return (
    <Dialog
      open
      title="新建任务"
      description="先写下要采购什么，其余信息可以稍后补充。"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" disabled={saving} onClick={onClose}>取消</Button>
          <Button icon={Plus} variant="primary" disabled={saving || name.trim().length === 0} onClick={() => void save()}>
            {saving ? '正在创建' : '创建任务'}
          </Button>
        </>
      }
    >
      <div className="new-task-form">
        <Field
          label="任务名称"
          value={name}
          autoFocus
          placeholder="例如：办公电脑批量采购"
          maxLength={200}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !expanded) void save(); }}
        />
        <Button icon={expanded ? ChevronUp : ChevronDown} variant="ghost" className="disclosure-button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {expanded ? '收起补充信息' : '补充截止时间、优先级与说明'}
        </Button>
        {expanded && (
          <div className="new-task-extra">
            <label className="ui-field">
              <span className="ui-field-label">任务类型</span>
              <span className="segmented-control" role="group" aria-label="任务类型">
                {KINDS.map((value) => <button type="button" key={value} aria-pressed={kind === value} className={kind === value ? 'active' : ''} onClick={() => setKind(value)}>{KIND_LABEL[value]}</button>)}
              </span>
            </label>
            <label className="ui-field">
              <span className="ui-field-label">紧急程度</span>
              <span className="segmented-control" role="group" aria-label="紧急程度">
                {URGENCIES.map((value) => <button type="button" key={value} aria-pressed={urgency === value} className={'urgency-' + value + (urgency === value ? ' active' : '')} onClick={() => setUrgency(value)}>{URGENCY_LABEL[value]}</button>)}
              </span>
            </label>
            <Field label="截止时间" type="datetime-local" value={deadlineText} onChange={(event) => setDeadlineText(event.target.value)} />
            <label className="ui-field">
              <span className="ui-field-label">任务说明</span>
              <textarea value={description} maxLength={1000} placeholder="记录范围、目标或需要特别留意的事项" onChange={(event) => setDescription(event.target.value)} />
            </label>
          </div>
        )}
        {error && <AsyncFeedback tone="error" message={error} onRetry={() => void save()} />}
      </div>
    </Dialog>
  );
}
