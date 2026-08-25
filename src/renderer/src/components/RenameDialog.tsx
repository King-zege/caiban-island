import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Field } from './ui/Field';

interface RenameDialogProps {
  kind: '任务' | '节点';
  currentName: string;
  onClose: () => void;
  onSave: (name: string) => Promise<string | null>;
}

export default function RenameDialog({ kind, currentName, onClose, onSave }: RenameDialogProps): React.JSX.Element {
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(currentName);
    setError(null);
  }, [currentName]);

  const save = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    const saveError = await onSave(name);
    setBusy(false);
    if (saveError) {
      setError(saveError);
      return;
    }
    onClose();
  };

  return (
    <Dialog
      open
      title={'编辑' + kind + '名称'}
      description="仅修改名称，不会改变说明、时间、状态或排序。"
      onClose={() => { if (!busy) onClose(); }}
      actions={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>取消</Button>
          <Button icon={Pencil} variant="primary" disabled={busy || name.trim().length === 0} onClick={() => void save()}>
            {busy ? '正在保存' : '保存名称'}
          </Button>
        </>
      }
    >
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <Field
          label={kind + '名称'}
          value={name}
          maxLength={200}
          autoFocus
          error={error}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setName(event.target.value)}
        />
      </form>
    </Dialog>
  );
}
