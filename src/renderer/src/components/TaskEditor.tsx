import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CalendarClock, CheckCircle2, ExternalLink, File, Link2, Plus, Trash2, TriangleAlert } from 'lucide-react';
import type { LinkInput, NodeInput, TaskDetail } from '../../../shared/types';
import { useTaskStore } from '../state/useStore';
import { useWorkspaceStore } from '../state/useWorkspaceStore';
import type { TaskWorkspaceSection } from '../state/useWorkspaceStore';
import Timeline from './Timeline';
import MarkdownNote from './MarkdownNote';
import { Button, IconButton } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { EmptyState } from './ui/EmptyState';
import { Field } from './ui/Field';

const URGENCY_LABEL = { critical: '紧急', high: '高', normal: '普通', low: '低' } as const;
const REMINDER_CHOICES = [
  { label: '提前 30 分钟', value: 30 },
  { label: '提前 1 小时', value: 60 },
  { label: '提前 1 天', value: 1440 }
];

type ArchiveAction = 'complete' | 'cancel' | null;

function formatDeadline(deadlineUtc: string | null, tzId: string): string {
  if (!deadlineUtc) return '未设置截止时间';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tzId
    }).format(new Date(deadlineUtc));
  } catch {
    return deadlineUtc.slice(0, 16).replace('T', ' ');
  }
}

export default function TaskEditor({ detail, section }: { detail: TaskDetail; section: TaskWorkspaceSection }): React.JSX.Element {
  const { task, nodes, links } = detail;
  const setNodeStatus = useTaskStore((state) => state.setNodeStatus);
  const removeNode = useTaskStore((state) => state.removeNode);
  const moveNode = useTaskStore((state) => state.moveNode);
  const addNode = useTaskStore((state) => state.addNode);
  const addLink = useTaskStore((state) => state.addLink);
  const removeLink = useTaskStore((state) => state.removeLink);
  const saveNote = useTaskStore((state) => state.saveNote);
  const completeTask = useTaskStore((state) => state.complete);
  const cancelTask = useTaskStore((state) => state.cancel);
  const pendingUndo = useWorkspaceStore((state) => state.pendingUndo);
  const scheduleUndo = useWorkspaceStore((state) => state.scheduleUndo);
  const notify = useWorkspaceStore((state) => state.notify);

  const [nodeTitle, setNodeTitle] = useState('');
  const [nodeError, setNodeError] = useState<string | null>(null);
  const [linkKind, setLinkKind] = useState<'url' | 'file'>('url');
  const [linkTarget, setLinkTarget] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [noteBody, setNoteBody] = useState(detail.note);
  const [remindOffsets, setRemindOffsets] = useState<number[]>([]);
  const [remindLoaded, setRemindLoaded] = useState(false);
  const [archiveAction, setArchiveAction] = useState<ArchiveAction>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);

  useEffect(() => {
    setNoteBody(detail.note);
  }, [detail.note, task.id]);

  useEffect(() => {
    setRemindLoaded(false);
    void window.api.listReminders(task.id).then((result) => {
      if (result.ok) setRemindOffsets(result.data);
      else notify(result.error, 'error');
      setRemindLoaded(true);
    });
  }, [notify, task.id]);

  const orderedNodes = useMemo(() => [...nodes].sort((a, b) => a.position - b.position), [nodes]);
  const hiddenIds = useMemo(() => pendingUndo ? new Set([pendingUndo.id]) : new Set<string>(), [pendingUndo]);
  const completedCount = nodes.filter((node) => node.status === 'completed').length;
  const nextNode = orderedNodes.find((node) => node.status === 'in_progress') ?? orderedNodes.find((node) => node.status === 'pending');
  const nextAction = task.kind === 'misc' ? '处理这项杂事' : nextNode?.title ?? (nodes.length === 0 ? '拆分采购节点' : '确认采购结果');
  const overdue = task.deadlineUtc ? Date.parse(task.deadlineUtc) < Date.now() : false;

  const toggleReminder = async (offset: number) => {
    const previous = remindOffsets;
    const next = previous.includes(offset) ? previous.filter((item) => item !== offset) : [...previous, offset].sort((a, b) => a - b);
    setRemindOffsets(next);
    const result = await window.api.setReminders(task.id, next);
    if (!result.ok) {
      setRemindOffsets(previous);
      notify(result.error, 'error');
    } else {
      notify('提醒已更新', 'success');
    }
  };

  const doAddNode = async () => {
    setNodeError(null);
    const input: NodeInput = { title: nodeTitle, description: '', startUtc: null, endUtc: null };
    const error = await addNode(task.id, input);
    if (error) {
      setNodeError(error);
      return;
    }
    setNodeTitle('');
    notify('节点已添加', 'success');
  };

  const doAddLink = async () => {
    setLinkError(null);
    const input: LinkInput = { kind: linkKind, title: linkTitle, target: linkTarget };
    const error = await addLink(task.id, input);
    if (error) {
      setLinkError(error);
      return;
    }
    setLinkTarget('');
    setLinkTitle('');
    notify('资料已添加', 'success');
  };

  const scheduleNodeRemoval = (nodeId: string, title: string) => {
    scheduleUndo({ id: nodeId, kind: 'node', label: '节点“' + title + '”', commit: () => removeNode(nodeId) });
  };

  const scheduleLinkRemoval = (linkId: string, title: string) => {
    scheduleUndo({ id: linkId, kind: 'link', label: '资料“' + title + '”', commit: () => removeLink(linkId) });
  };

  const runArchiveAction = async () => {
    if (!archiveAction) return;
    setArchiveBusy(true);
    const error = archiveAction === 'complete' ? await completeTask(task.id) : await cancelTask(task.id);
    setArchiveBusy(false);
    if (error) {
      notify(error, 'error');
      return;
    }
    notify(archiveAction === 'complete' ? '任务已完成并归档' : '任务已取消并归档', 'success');
    setArchiveAction(null);
  };

  if (section === 'overview') {
    return (
      <div className="task-workspace-section overview-section">
        <div className="overview-hero">
          <div className="overview-next">
            <span className="eyebrow">下一采购动作</span>
            <h2>{nextAction}</h2>
            <p>{task.description || '围绕当前动作补齐节点、资料与提醒。'}</p>
          </div>
          <div className={'risk-readout' + (overdue ? ' overdue' : '')}>
            {overdue ? <TriangleAlert aria-hidden="true" size={22} /> : <CalendarClock aria-hidden="true" size={22} />}
            <span>{overdue ? '已经逾期' : '截止时间'}</span>
            <strong>{formatDeadline(task.deadlineUtc, task.tzId)}</strong>
          </div>
        </div>
        <div className="overview-facts" aria-label="任务概览">
          <div><span>紧急程度</span><strong>{URGENCY_LABEL[task.urgency]}</strong></div>
          <div><span>采购进度</span><strong>{nodes.length === 0 ? '待拆分' : completedCount + ' / ' + nodes.length}</strong></div>
          <div><span>关联资料</span><strong>{links.length} 项</strong></div>
        </div>
        <section className="workspace-block">
          <div className="section-heading">
            <div><span className="eyebrow">采购链路</span><h3>从计划到完成</h3></div>
            <span>{nodes.length} 个节点</span>
          </div>
          <Timeline nodes={nodes} hiddenIds={hiddenIds} />
        </section>
        <div className="overview-archive-actions">
          <Button icon={CheckCircle2} onClick={() => setArchiveAction('complete')}>完成任务</Button>
          <Button variant="ghost" onClick={() => setArchiveAction('cancel')}>取消任务</Button>
        </div>
        <Dialog
          open={archiveAction !== null}
          title={archiveAction === 'complete' ? '确认完成任务？' : '确认取消任务？'}
          description="任务将进入归档，当前页面不会继续保留它。"
          onClose={() => setArchiveAction(null)}
          actions={
            <>
              <Button variant="ghost" disabled={archiveBusy} onClick={() => setArchiveAction(null)}>返回</Button>
              <Button variant={archiveAction === 'complete' ? 'primary' : 'danger'} disabled={archiveBusy} onClick={() => void runArchiveAction()}>
                {archiveBusy ? '正在处理' : archiveAction === 'complete' ? '确认完成' : '确认取消'}
              </Button>
            </>
          }
        >
          <p>任务“{task.name}”的节点、资料和备注会一并保存到归档记录。</p>
        </Dialog>
      </div>
    );
  }

  if (section === 'nodes') {
    return (
      <div className="task-workspace-section">
        <div className="section-heading">
          <div><span className="eyebrow">采购节点</span><h2>管理执行顺序与状态</h2></div>
          <span>{completedCount} / {nodes.length} 已完成</span>
        </div>
        <Timeline
          nodes={nodes}
          editable
          hiddenIds={hiddenIds}
          onStatus={(nodeId, status) => void setNodeStatus(nodeId, status).then((error) => error && notify(error, 'error'))}
        />
        {orderedNodes.filter((node) => !hiddenIds.has(node.id)).length > 0 && (
          <ul className="node-admin" aria-label="调整节点顺序">
            {orderedNodes.filter((node) => !hiddenIds.has(node.id)).map((node, index, visibleNodes) => (
              <li key={node.id}>
                <span>{node.title}</span>
                <span className="row-actions">
                  <IconButton icon={ArrowUp} label={'上移' + node.title} disabled={index === 0} onClick={() => void moveNode(task.id, node.id, -1).then((error) => error && notify(error, 'error'))} />
                  <IconButton icon={ArrowDown} label={'下移' + node.title} disabled={index === visibleNodes.length - 1} onClick={() => void moveNode(task.id, node.id, 1).then((error) => error && notify(error, 'error'))} />
                  <IconButton icon={Trash2} label={'删除' + node.title} variant="danger" onClick={() => scheduleNodeRemoval(node.id, node.title)} />
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="inline-composer">
          <Field
            label="新节点名称"
            value={nodeTitle}
            placeholder="例如：询价、比价、签订合同"
            maxLength={200}
            error={nodeError}
            onChange={(event) => setNodeTitle(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void doAddNode(); }}
          />
          <Button icon={Plus} variant="primary" disabled={nodeTitle.trim().length === 0} onClick={() => void doAddNode()}>添加节点</Button>
        </div>
      </div>
    );
  }

  if (section === 'materials') {
    return (
      <div className="task-workspace-section">
        <div className="section-heading">
          <div><span className="eyebrow">资料</span><h2>链接、文件与导出</h2></div>
          <Button icon={ExternalLink} variant="ghost" onClick={() => void window.api.exportTaskCsv(task.id)}>导出 CSV</Button>
        </div>
        {links.filter((link) => !hiddenIds.has(link.id)).length === 0 ? (
          <EmptyState icon={Link2} title="还没有关联资料" description="添加报价页面、合同文件或采购依据，后续查找会更快。" />
        ) : (
          <ul className="material-list">
            {links.filter((link) => !hiddenIds.has(link.id)).map((link) => {
              const LinkIcon = link.kind === 'url' ? Link2 : File;
              return (
                <li key={link.id}>
                  <LinkIcon aria-hidden="true" size={19} />
                  <button className="material-link" title={link.target} onClick={() => link.kind === 'url' ? void window.api.openUrl(link.target) : void window.api.openPath(link.target)}>
                    <strong>{link.title}</strong><span>{link.target}</span>
                  </button>
                  {link.kind === 'file' && <Button variant="ghost" onClick={() => void window.api.showInFolder(link.target)}>定位</Button>}
                  <IconButton icon={Trash2} label={'删除' + link.title} variant="danger" onClick={() => scheduleLinkRemoval(link.id, link.title)} />
                </li>
              );
            })}
          </ul>
        )}
        <div className="material-composer">
          <label className="ui-field">
            <span className="ui-field-label">资料类型</span>
            <span className="ui-field-control"><select value={linkKind} onChange={(event) => setLinkKind(event.target.value as 'url' | 'file')}><option value="url">网址</option><option value="file">文件</option></select></span>
          </label>
          <Field label={linkKind === 'url' ? '网址' : '文件路径'} value={linkTarget} placeholder={linkKind === 'url' ? 'https://example.com' : '选择或粘贴文件路径'} error={linkError} onChange={(event) => setLinkTarget(event.target.value)} />
          <Field label="显示名称" value={linkTitle} placeholder="可选" onChange={(event) => setLinkTitle(event.target.value)} />
          <Button icon={Plus} variant="primary" disabled={linkTarget.trim().length === 0} onClick={() => void doAddLink()}>添加资料</Button>
        </div>
      </div>
    );
  }

  if (section === 'reminders') {
    return (
      <div className="task-workspace-section">
        <div className="section-heading"><div><span className="eyebrow">提醒</span><h2>在截止前提醒我</h2></div></div>
        {!task.deadlineUtc ? (
          <EmptyState icon={CalendarClock} title="先设置截止时间" description="提醒需要一个明确的截止时间，当前任务尚未设置。" />
        ) : !remindLoaded ? (
          <p className="loading-state">正在加载提醒</p>
        ) : (
          <div className="reminder-options" role="group" aria-label="提醒时间">
            {REMINDER_CHOICES.map((choice) => (
              <label key={choice.value}>
                <input type="checkbox" checked={remindOffsets.includes(choice.value)} onChange={() => void toggleReminder(choice.value)} />
                <span><CalendarClock aria-hidden="true" size={19} /><strong>{choice.label}</strong><small>在任务截止前通知</small></span>
              </label>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="task-workspace-section">
      <div className="section-heading"><div><span className="eyebrow">备注</span><h2>记录决策与跟进信息</h2></div></div>
      <MarkdownNote body={noteBody} onChange={setNoteBody} />
      <div className="note-actions">
        <Button
          variant="primary"
          onClick={() => void saveNote(task.id, noteBody).then((error) => notify(error ?? '备注已保存', error ? 'error' : 'success'))}
        >保存备注</Button>
      </div>
    </div>
  );
}
