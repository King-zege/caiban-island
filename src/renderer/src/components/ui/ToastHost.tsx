import { RotateCcw, X } from 'lucide-react';
import { useWorkspaceStore } from '../../state/useWorkspaceStore';
import { Button, IconButton } from './Button';

export function ToastHost(): React.JSX.Element | null {
  const pendingUndo = useWorkspaceStore((state) => state.pendingUndo);
  const undoPending = useWorkspaceStore((state) => state.undoPending);
  const toast = useWorkspaceStore((state) => state.toast);
  const clearToast = useWorkspaceStore((state) => state.clearToast);

  if (!pendingUndo && !toast) return null;
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="true">
      {pendingUndo && (
        <div className="ui-toast undo">
          <span>{pendingUndo.label}将在 5 秒后删除</span>
          <Button icon={RotateCcw} variant="ghost" onClick={undoPending}>撤销</Button>
        </div>
      )}
      {toast && (
        <div className={'ui-toast ' + toast.tone} role={toast.tone === 'error' ? 'alert' : 'status'}>
          <span>{toast.message}</span>
          <IconButton icon={X} label="关闭提示" onClick={clearToast} />
        </div>
      )}
    </div>
  );
}
