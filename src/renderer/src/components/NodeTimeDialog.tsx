import { useEffect, useRef, useState } from 'react';
import type { NodeStatus } from '../../../shared/types';
import { dateTimeLocalToUtc, utcToDateTimeLocal } from '../../../shared/time';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Field } from './ui/Field';

interface NodeTimeDialogProps {
  open: boolean;
  mode: 'quick' | 'full';
  nodeTitle: string;
  status: NodeStatus;
  startUtc: string | null;
  endUtc?: string | null;
  taskDeadlineUtc: string | null;
  tzId: string;
  resolveReturnFocus?: () => HTMLElement | null;
  onClose: () => void;
  onSave: (startUtc: string | null, endUtc: string | null) => Promise<string | null>;
}

export default function NodeTimeDialog({
  open,
  mode,
  nodeTitle,
  status,
  startUtc,
  endUtc = null,
  taskDeadlineUtc,
  tzId,
  resolveReturnFocus,
  onClose,
  onSave
}: NodeTimeDialogProps): React.JSX.Element {
  const [startText, setStartText] = useState('');
  const [endText, setEndText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deadlineConfirmed, setDeadlineConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  );

  useEffect(() => {
    if (!open) return;
    setStartText(utcToDateTimeLocal(startUtc, tzId));
    setEndText(utcToDateTimeLocal(endUtc, tzId));
    setError(null);
    setDeadlineConfirmed(false);
    setBusy(false);
  }, [endUtc, open, startUtc, tzId]);

  const changeStart = (value: string) => {
    setStartText(value);
    setError(null);
    setDeadlineConfirmed(false);
  };

  const changeEnd = (value: string) => {
    setEndText(value);
    setError(null);
    setDeadlineConfirmed(false);
  };

  const save = async () => {
    const nextStart = startText ? dateTimeLocalToUtc(startText, tzId) : null;
    const nextEnd = mode === 'full' && endText ? dateTimeLocalToUtc(endText, tzId) : mode === 'full' ? null : endUtc;
    if ((startText && !nextStart) || (mode === 'full' && endText && !nextEnd)) {
      setError('时间无法按任务时区解析，请选择有效的日期和时间');
      return;
    }
    if (nextStart && (status === 'pending' || status === 'in_progress') && nextStart !== startUtc) {
      const currentMinute = Math.floor(Date.now() / 60000) * 60000;
      if (Date.parse(nextStart) < currentMinute) {
        setError('节点开始时间不能早于当前时间');
        return;
      }
    }
    if (nextStart && nextEnd && Date.parse(nextEnd) < Date.parse(nextStart)) {
      setError('节点截止时间不能早于开始时间');
      return;
    }
    const relevantTimes = mode === 'full' ? [nextStart, nextEnd] : [nextStart];
    const exceedsDeadline = taskDeadlineUtc !== null
      && relevantTimes.some((value) => value !== null && Date.parse(value) > Date.parse(taskDeadlineUtc));
    if (exceedsDeadline && !deadlineConfirmed) {
      setDeadlineConfirmed(true);
      setError('节点时间晚于任务截止时间；请再次确认是否仍要保存');
      return;
    }
    setBusy(true);
    const saveError = await onSave(nextStart, nextEnd);
    setBusy(false);
    if (saveError) {
      setError(saveError);
      return;
    }
    closeDialog();
  };

  const clearTimes = () => {
    changeStart('');
    if (mode === 'full') changeEnd('');
  };

  const closeDialog = () => {
    onClose();
    window.setTimeout(() => (resolveReturnFocus?.() ?? returnFocus.current)?.focus(), 0);
  };

  const timeZoneLabel = tzId || '当前系统时区';
  return (
    <Dialog
      open={open}
      title={(startUtc ? '修改' : '设置') + (mode === 'quick' ? '节点提醒' : '节点时间')}
      description={'节点“' + nodeTitle + '” · ' + timeZoneLabel}
      onClose={() => { if (!busy) closeDialog(); }}
      actions={
        <>
          {(startUtc || (mode === 'full' && endUtc)) && <Button variant="danger" disabled={busy} onClick={clearTimes}>{mode === 'quick' ? '清除提醒' : '清除时间'}</Button>}
          <Button variant="ghost" disabled={busy} onClick={closeDialog}>取消</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? '正在保存' : deadlineConfirmed ? '仍要保存' : '保存时间'}
          </Button>
        </>
      }
    >
      <div className="node-time-fields">
        <Field
          label={mode === 'quick' ? '提醒时间' : '开始时间（到时提醒）'}
          type="datetime-local"
          value={startText}
          onChange={(event) => changeStart(event.target.value)}
          hint="留空则不提醒"
        />
        {mode === 'full' && (
          <Field
            label="截止时间（仅用于计划）"
            type="datetime-local"
            value={endText}
            onChange={(event) => changeEnd(event.target.value)}
            hint="截止时间不会额外发送提醒"
          />
        )}
        {error && <p className="node-time-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}
