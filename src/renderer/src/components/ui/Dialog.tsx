import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './Button';

interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
}

export function Dialog({ open, title, description, children, actions, onClose }: DialogProps): React.JSX.Element {
  const ref = useRef<HTMLDialogElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const close = () => {
    onClose();
    queueMicrotask(() => returnFocus.current?.focus());
  };

  return (
    <dialog ref={ref} className="ui-dialog" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} onCancel={(event) => { event.preventDefault(); close(); }}>
      <div className="ui-dialog-head">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </div>
        <IconButton icon={X} label="关闭" onClick={close} />
      </div>
      <div className="ui-dialog-body">{children}</div>
      {actions && <div className="ui-dialog-actions">{actions}</div>}
    </dialog>
  );
}
