import { useState } from 'react';
import { Save } from 'lucide-react';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Field } from './ui/Field';
import { AsyncFeedback } from './ui/AsyncFeedback';

interface ProjectNamesDialogProps {
  fullName: string;
  shortName: string;
  onClose: () => void;
  onSave: (fullName: string, shortName: string) => Promise<string | null>;
}

export default function ProjectNamesDialog({ fullName: initialFullName, shortName: initialShortName, onClose, onSave }: ProjectNamesDialogProps): React.JSX.Element {
  const [fullName, setFullName] = useState(initialFullName);
  const [shortName, setShortName] = useState(initialShortName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (saving || !fullName.trim() || !shortName.trim()) return;
    setSaving(true);
    setError(null);
    const result = await onSave(fullName, shortName);
    setSaving(false);
    if (result) setError(result);
    else onClose();
  };

  return (
    <Dialog
      open
      title="编辑项目名称"
      description="正式名称用于文件、搜索和 Agent 上下文；简称只用于紧凑卡片。"
      onClose={onClose}
      actions={<>
        <Button variant="ghost" disabled={saving} onClick={onClose}>取消</Button>
        <Button icon={Save} variant="primary" disabled={saving || !fullName.trim() || !shortName.trim()} onClick={() => void save()}>{saving ? '正在保存' : '保存名称'}</Button>
      </>}
    >
      <div className="new-task-form">
        <Field label="正式名称" value={fullName} autoFocus maxLength={500} onChange={(event) => setFullName(event.target.value)} />
        <Field label="卡片简称" value={shortName} maxLength={24} hint="最多 24 个字符" onChange={(event) => setShortName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void save(); }} />
        {error && <AsyncFeedback tone="error" message={error} onRetry={() => void save()} />}
      </div>
    </Dialog>
  );
}
