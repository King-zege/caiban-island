import { useEffect, useState } from 'react';
import type { LinkInput, NodeInput, TaskDetail } from '../../../shared/types';
import { useTaskStore } from '../state/useStore';
import Timeline from './Timeline';
import MarkdownNote from './MarkdownNote';

const URGENCY_LABEL: Record<string, string> = { critical: '紧急', high: '高', normal: '普通', low: '低' };

export default function TaskEditor({ detail }: { detail: TaskDetail }): React.JSX.Element {
  const { task, nodes, links } = detail;
  const setNodeStatus = useTaskStore((s) => s.setNodeStatus);
  const removeNode = useTaskStore((s) => s.removeNode);
  const moveNode = useTaskStore((s) => s.moveNode);
  const addNode = useTaskStore((s) => s.addNode);
  const addLink = useTaskStore((s) => s.addLink);
  const removeLink = useTaskStore((s) => s.removeLink);
  const saveNote = useTaskStore((s) => s.saveNote);

  const [nodeTitle, setNodeTitle] = useState('');
  const [nodeError, setNodeError] = useState<string | null>(null);
  const [linkKind, setLinkKind] = useState<'url' | 'file'>('url');
  const [linkTarget, setLinkTarget] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [noteBody, setNoteBody] = useState(detail.note);
  const [noteSaved, setNoteSaved] = useState<boolean | null>(null);
  const [remindOffsets, setRemindOffsets] = useState<number[]>([]);
  const [remindLoaded, setRemindLoaded] = useState(false);

  // 加载任务的提醒提前量
  useEffect(() => {
    void window.api.listReminders(task.id).then((r) => {
      if (r.ok) setRemindOffsets(r.data);
      setRemindLoaded(true);
    });
  }, [task.id]);

  const toggleReminder = async (off: number) => {
    const next = remindOffsets.includes(off) ? remindOffsets.filter((o) => o !== off) : [...remindOffsets, off].sort((a, b) => a - b);
    setRemindOffsets(next);
    await window.api.setReminders(task.id, next);
  };

  const doAddNode = async () => {
    setNodeError(null);
    const input: NodeInput = { title: nodeTitle, description: '', startUtc: null, endUtc: null };
    const err = await addNode(task.id, input);
    if (err) {
      setNodeError(err);
      return;
    }
    setNodeTitle('');
  };

  const doAddLink = async () => {
    setLinkError(null);
    const input: LinkInput = { kind: linkKind, title: linkTitle, target: linkTarget };
    const err = await addLink(task.id, input);
    if (err) {
      setLinkError(err);
      return;
    }
    setLinkTarget('');
    setLinkTitle('');
  };

  const REMINDER_CHOICES = [
    { label: '提前 30 分钟', value: 30 },
    { label: '提前 1 小时', value: 60 },
    { label: '提前 1 天', value: 1440 }
  ];

  const doSaveNote = async () => {
    setNoteSaved(null);
    const err = await saveNote(task.id, noteBody);
    setNoteSaved(err === null);
  };

  return (
    <div className="task-editor">
      <div className="editor-head">
        <div>
          <h2 className="editor-name">{task.name}</h2>
          <div className="editor-meta">
            <span className={'chip urgency-' + task.urgency}>{URGENCY_LABEL[task.urgency]}</span>
            <span className="chip deadline">{task.deadlineUtc ? task.deadlineUtc.slice(0, 10) : '未设置截止时间'}</span>
            {task.kind === 'misc' && <span className="chip kind-misc">杂事</span>}
          </div>
        </div>
      </div>

      <section className="editor-section">
        <h3 className="section-title">时间轴节点（点击节点切换 待完成→进行中→已完成）</h3>
        <Timeline nodes={nodes} onStatus={(id, s) => void setNodeStatus(id, s)} />
        <ul className="node-admin">
          {[...nodes]
            .sort((a, b) => a.position - b.position)
            .map((n, i) => (
              <li key={n.id} className="node-admin-row">
                <span className="node-admin-title">{n.title}</span>
                <button className="btn small" disabled={i === 0} onClick={() => void moveNode(task.id, n.id, -1)} title="上移">
                  ↑
                </button>
                <button className="btn small" disabled={i === nodes.length - 1} onClick={() => void moveNode(task.id, n.id, 1)} title="下移">
                  ↓
                </button>
                <button className="btn small danger-outline" onClick={() => void removeNode(n.id)} title="删除节点">
                  删除
                </button>
              </li>
            ))}
        </ul>
        <div className="inline-add">
          <input
            className="text-input grow"
            value={nodeTitle}
            placeholder="新节点名称，如：询价、比价、签合同"
            maxLength={200}
            onChange={(e) => setNodeTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void doAddNode();
            }}
          />
          <button className="btn" disabled={nodeTitle.trim().length === 0} onClick={() => void doAddNode()}>
            添加节点
          </button>
        </div>
        {nodeError && <p className="form-error">{nodeError}</p>}
      </section>

      <section className="editor-section">
        <h3 className="section-title">链接（{links.length}）</h3>
        <ul className="link-list">
          {links.map((l) => (
            <li key={l.id} className="link-row">
              <span className={'link-kind ' + l.kind}>{l.kind === 'url' ? '🔗' : '📄'}</span>
              <button className="link-title" title={l.target} onClick={() => (l.kind === 'url' ? void window.api.openUrl(l.target) : void window.api.openPath(l.target))}>
                {l.title}
              </button>
              {l.kind === 'file' && (
                <button className="link-action" onClick={() => void window.api.showInFolder(l.target)}>
                  定位
                </button>
              )}
              <button className="link-action danger" onClick={() => void removeLink(l.id)}>
                删除
              </button>
            </li>
          ))}
        </ul>
        <div className="inline-add">
          <div className="chip-group">
            <button className={'chip-btn' + (linkKind === 'url' ? ' active' : '')} onClick={() => setLinkKind('url')}>
              网址
            </button>
            <button className={'chip-btn' + (linkKind === 'file' ? ' active' : '')} onClick={() => setLinkKind('file')}>
              文件
            </button>
          </div>
          <input
            className="text-input grow"
            value={linkTarget}
            placeholder={linkKind === 'url' ? 'https://…' : 'C:\… 或文件路径'}
            onChange={(e) => setLinkTarget(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void doAddLink();
            }}
          />
          <input
            className="text-input grow-half"
            value={linkTitle}
            placeholder="显示名称（可选）"
            onChange={(e) => setLinkTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void doAddLink();
            }}
          />
          <button className="btn" disabled={linkTarget.trim().length === 0} onClick={() => void doAddLink()}>
            添加
          </button>
        </div>
        {linkError && <p className="form-error">{linkError}</p>}
      </section>

      <section className="editor-section">
        <h3 className="section-title">提醒（FR-060：需先设置截止时间）</h3>
        {remindLoaded && (
          <div className="chip-group">
            {REMINDER_CHOICES.map((c) => (
              <button
                key={c.value}
                className={'chip-btn' + (remindOffsets.includes(c.value) ? ' active' : '')}
                disabled={!task.deadlineUtc}
                onClick={() => void toggleReminder(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        {!task.deadlineUtc && <p className="detail-empty">未设置截止时间，无法添加提醒</p>}
      </section>

      <section className="editor-section">
        <h3 className="section-title">备注（Markdown）</h3>
        <MarkdownNote body={noteBody} onChange={setNoteBody} />
        <div className="note-actions">
          <button className="btn primary" onClick={() => void doSaveNote()}>
            保存备注
          </button>
          {noteSaved === true && <span className="note-saved">已保存 ✓</span>}
          {noteSaved === false && <span className="form-error">保存失败</span>}
        </div>
      </section>
    </div>
  );
}
