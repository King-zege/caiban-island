import { Bell, CheckCircle2, ExternalLink, File, Link2, Plus, Trash2, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { LinkInput, TaskDetail } from '../../../shared/types';
import { dateTimeLocalToUtc, formatUtcInTimeZone, utcToDateTimeLocal } from '../../../shared/time';
import { useTaskStore } from '../state/useStore';
import { useWorkspaceStore } from '../state/useWorkspaceStore';
import MarkdownNote from './MarkdownNote';
import { AsyncFeedback } from './ui/AsyncFeedback';
import { Button, IconButton } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { ExternalTargetDialog } from './ui/ExternalTargetDialog';
import type { ExternalTarget } from './ui/ExternalTargetDialog';
import { Field } from './ui/Field';

type LifecycleAction = 'complete' | 'cancel' | 'delete' | null;
type ErrorScope = 'legacy' | 'reminder' | 'note' | 'materials' | 'lifecycle';

interface ScopedError {
  scope: ErrorScope;
  message: string;
}

export default function MiscEditor({ detail }: { detail: TaskDetail }): React.JSX.Element {
  const task = detail.task;
  const setReminder = useTaskStore((state) => state.setMiscReminder);
  const resolveLegacy = useTaskStore((state) => state.resolveLegacyMiscDeadline);
  const saveNote = useTaskStore((state) => state.saveNote);
  const addLink = useTaskStore((state) => state.addLink);
  const removeLink = useTaskStore((state) => state.removeLink);
  const complete = useTaskStore((state) => state.complete);
  const cancel = useTaskStore((state) => state.cancel);
  const deleteTask = useTaskStore((state) => state.deleteTask);
  const pendingUndo = useWorkspaceStore((state) => state.pendingUndo);
  const scheduleUndo = useWorkspaceStore((state) => state.scheduleUndo);
  const notify = useWorkspaceStore((state) => state.notify);
  const [reminderText, setReminderText] = useState(() => utcToDateTimeLocal(task.remindAtUtc, task.tzId));
  const [note, setNote] = useState(detail.note);
  const [linkKind, setLinkKind] = useState<LinkInput['kind']>('url');
  const [linkTarget, setLinkTarget] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [error, setError] = useState<ScopedError | null>(null);
  const [externalTarget, setExternalTarget] = useState<ExternalTarget | null>(null);
  const [lifecycle, setLifecycle] = useState<LifecycleAction>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setReminderText(utcToDateTimeLocal(task.remindAtUtc, task.tzId));
    setNote(detail.note);
    setError(null);
  }, [detail.note, task.id, task.remindAtUtc, task.tzId]);

  const visibleLinks = useMemo(
    () => detail.links.filter((link) => !(pendingUndo?.kind === 'link' && pendingUndo.id === link.id)),
    [detail.links, pendingUndo]
  );

  const saveReminder = async () => {
    const value = reminderText ? dateTimeLocalToUtc(reminderText, task.tzId) : null;
    if (reminderText && !value) {
      setError({ scope: 'reminder', message: '提醒时间无效，请重新选择' });
      return;
    }
    setError(null);
    setBusy(true);
    const result = await setReminder({ taskId: task.id, remindAtUtc: value, expectedRemindAtUtc: task.remindAtUtc });
    setBusy(false);
    setError(result ? { scope: 'reminder', message: result } : null);
    if (!result) notify(value ? '杂事提醒已更新' : '杂事提醒已清除', 'success');
  };

  const clearReminder = async () => {
    setError(null);
    setBusy(true);
    const result = await setReminder({ taskId: task.id, remindAtUtc: null, expectedRemindAtUtc: task.remindAtUtc });
    setBusy(false);
    setError(result ? { scope: 'reminder', message: result } : null);
    if (!result) {
      setReminderText('');
      notify('杂事提醒已清除', 'success');
    }
  };

  const handleLegacy = async (action: 'convert' | 'clear') => {
    if (!task.deadlineUtc) return;
    setError(null);
    setBusy(true);
    const result = await resolveLegacy({ taskId: task.id, action, expectedDeadlineUtc: task.deadlineUtc });
    setBusy(false);
    setError(result ? { scope: 'legacy', message: result } : null);
    if (!result) notify(action === 'convert' ? '旧截止时间已改为精确提醒' : '旧截止时间已清除', 'success');
  };

  const doAddLink = async () => {
    if (!linkTarget.trim()) return;
    setError(null);
    const result = await addLink(task.id, { kind: linkKind, target: linkTarget, title: linkTitle });
    setError(result ? { scope: 'materials', message: result } : null);
    if (!result) {
      setLinkTarget('');
      setLinkTitle('');
      notify('资料已添加', 'success');
    }
  };

  const doSaveNote = async () => {
    setError(null);
    const result = await saveNote(task.id, note);
    setError(result ? { scope: 'note', message: result } : null);
    notify(result ?? '备注已保存', result ? 'error' : 'success');
  };

  const scheduleLinkDelete = (id: string, title: string) => {
    const scheduled = scheduleUndo({ id, kind: 'link', label: '资料「' + title + '」', commit: () => removeLink(id) });
    if (scheduled) notify('资料将在 5 秒后删除，可撤销', 'info');
  };

  const confirmLifecycle = async () => {
    if (!lifecycle) return;
    if (lifecycle === 'delete') {
      const scheduled = scheduleUndo({ id: task.id, kind: 'task', label: '杂事「' + task.name + '」', commit: () => deleteTask(task.id) });
      if (scheduled) setLifecycle(null);
      return;
    }
    setBusy(true);
    const result = lifecycle === 'complete' ? await complete(task.id) : await cancel(task.id);
    setBusy(false);
    if (result) {
      setError({ scope: 'lifecycle', message: result });
      return;
    }
    notify(lifecycle === 'complete' ? '杂事已完成并归档' : '杂事已取消并归档', 'success');
    setLifecycle(null);
  };

  const legacyFuture = task.deadlineUtc ? Date.parse(task.deadlineUtc) >= Math.floor(Date.now() / 60000) * 60000 : false;

  return (
    <div className="misc-editor">
      {task.deadlineUtc && <section className="misc-legacy" aria-labelledby="legacy-time-title">
        <div><strong id="legacy-time-title">旧版本截止时间待处理</strong><p>{formatUtcInTimeZone(task.deadlineUtc, task.tzId)}。升级后它不会自动提醒。</p></div>
        <div className="misc-inline-actions">
          {legacyFuture && <Button icon={Bell} variant="primary" disabled={busy} onClick={() => void handleLegacy('convert')}>改为提醒</Button>}
          <Button variant="ghost" disabled={busy} onClick={() => void handleLegacy('clear')}>清除旧时间</Button>
        </div>
        {error?.scope === 'legacy' && <AsyncFeedback tone="error" message={error.message} />}
      </section>}

      <section className="misc-section" aria-labelledby="misc-reminder-title">
        <div className="section-heading"><div><h2 id="misc-reminder-title">提醒时间</h2><p>只在这个时间提醒一次；留空则不提醒。</p></div></div>
        <div className="misc-reminder-editor">
          <Field label="日期和时间" type="datetime-local" value={reminderText} onChange={(event) => setReminderText(event.target.value)} />
          <Button icon={Bell} variant="primary" disabled={busy} onClick={() => void saveReminder()}>保存提醒</Button>
          {task.remindAtUtc && <Button variant="ghost" disabled={busy} onClick={() => void clearReminder()}>清除提醒</Button>}
        </div>
        {error?.scope === 'reminder' && <AsyncFeedback tone="error" message={error.message} />}
      </section>

      <section className="misc-section" aria-labelledby="misc-note-title">
        <div className="section-heading"><div><h2 id="misc-note-title">备注</h2><p>记录联系结果、地址或需要记住的细节。</p></div></div>
        <MarkdownNote body={note} onChange={setNote} onOpenExternal={(target) => setExternalTarget({ kind: 'url', target, title: '备注中的链接' })} />
        <div className="note-actions"><Button variant="primary" onClick={() => void doSaveNote()}>保存备注</Button></div>
        {error?.scope === 'note' && <AsyncFeedback tone="error" message={error.message} />}
      </section>

      <section className="misc-section" aria-labelledby="misc-material-title">
        <div className="section-heading"><div><h2 id="misc-material-title">链接与附件</h2><p>只保存目标地址，不读取文件内容。</p></div><Button icon={ExternalLink} variant="ghost" onClick={() => void window.api.exportTaskCsv(task.id)}>导出 CSV</Button></div>
        {visibleLinks.length > 0 && <ul className="material-list">
          {visibleLinks.map((link) => {
            const Icon = link.kind === 'url' ? Link2 : File;
            return <li key={link.id}>
              <Icon aria-hidden="true" size={18} />
              <button className="material-link" onClick={() => setExternalTarget({ kind: link.kind, target: link.target, title: link.title })}><strong>{link.title}</strong><span>{link.target}</span></button>
              <IconButton icon={Trash2} label={'删除' + link.title} variant="danger" onClick={() => scheduleLinkDelete(link.id, link.title)} />
            </li>;
          })}
        </ul>}
        <div className="material-composer misc-material-composer">
          <label className="ui-field"><span className="ui-field-label">资料类型</span><span className="ui-field-control"><select value={linkKind} onChange={(event) => setLinkKind(event.target.value as LinkInput['kind'])}><option value="url">网址</option><option value="file">文件</option></select></span></label>
          <Field label={linkKind === 'url' ? '网址' : '文件路径'} value={linkTarget} onChange={(event) => setLinkTarget(event.target.value)} />
          <Field label="显示名称" value={linkTitle} placeholder="可选" onChange={(event) => setLinkTitle(event.target.value)} />
          <Button icon={Plus} variant="primary" disabled={!linkTarget.trim()} onClick={() => void doAddLink()}>添加资料</Button>
        </div>
        {error?.scope === 'materials' && <AsyncFeedback tone="error" message={error.message} />}
      </section>

      <section className="misc-section misc-lifecycle" aria-labelledby="misc-lifecycle-title">
        <div><h2 id="misc-lifecycle-title">完成或移除</h2><p>完成与取消会进入归档，永久删除不会保留快照。</p></div>
        <div className="misc-inline-actions">
          <Button icon={CheckCircle2} variant="primary" onClick={() => setLifecycle('complete')}>完成</Button>
          <Button icon={XCircle} variant="ghost" onClick={() => setLifecycle('cancel')}>取消</Button>
          <Button icon={Trash2} variant="danger" onClick={() => setLifecycle('delete')}>永久删除</Button>
        </div>
        {error?.scope === 'lifecycle' && <AsyncFeedback tone="error" message={error.message} />}
      </section>

      <ExternalTargetDialog target={externalTarget} onClose={() => setExternalTarget(null)} />
      <Dialog
        open={lifecycle !== null}
        title={lifecycle === 'complete' ? '完成这项杂事？' : lifecycle === 'cancel' ? '取消这项杂事？' : '永久删除这项杂事？'}
        description={lifecycle === 'delete' ? '确认后有 5 秒可以撤销。' : '它会进入归档，之后可以恢复。'}
        onClose={() => { if (!busy) setLifecycle(null); }}
        actions={<><Button variant="ghost" disabled={busy} onClick={() => setLifecycle(null)}>返回</Button><Button variant={lifecycle === 'delete' ? 'danger' : 'primary'} disabled={busy} onClick={() => void confirmLifecycle()}>确认</Button></>}
      ><p>杂事：{task.name}</p></Dialog>
    </div>
  );
}
