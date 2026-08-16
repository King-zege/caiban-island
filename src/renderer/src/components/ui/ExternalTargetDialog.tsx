import { useEffect, useState } from 'react';
import { ExternalLink, File } from 'lucide-react';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { AsyncFeedback } from './AsyncFeedback';

export interface ExternalTarget {
  kind: 'url' | 'file';
  target: string;
  title: string;
}

export function ExternalTargetDialog({ target, onClose }: { target: ExternalTarget | null; onClose: () => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBusy(false);
    setError(null);
  }, [target?.kind, target?.target]);

  const confirm = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const result = target.kind === 'url' ? await window.api.openUrl(target.target) : await window.api.openPath(target.target);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClose();
    } catch {
      setError('系统未能打开该目标，请检查地址后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={target !== null}
      title="确认打开外部目标"
      description="离开采办岛前，请核对完整地址。"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button icon={target?.kind === 'file' ? File : ExternalLink} variant="primary" disabled={busy} onClick={() => void confirm()}>{busy ? '正在打开' : '确认打开'}</Button>
        </>
      }
    >
      {target && (
        <div className="external-target">
          <strong>{target.title}</strong>
          <code>{target.target}</code>
          {error && <AsyncFeedback tone="error" message={error} onRetry={() => void confirm()} />}
        </div>
      )}
    </Dialog>
  );
}
