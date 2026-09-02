import { FileSignature, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { CONTRACT_ACTION_LABELS } from '../../../shared/contractContracts';
import type { ContractActionType, ContractCreateRequest, ContractInitialActionInput, ContractLinkInput } from '../../../shared/contractContracts';
import type { TaskCard } from '../../../shared/taskContracts';
import { useContractStore } from '../state/useContractStore';
import { useWorkspaceStore } from '../state/useWorkspaceStore';
import { AsyncFeedback } from './ui/AsyncFeedback';
import { Button, IconButton } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Field } from './ui/Field';

function amountToMinor(value: string, currency: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const digits = new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`).test(normalized)) throw new Error(`金额最多保留 ${digits} 位小数`);
  const [whole, fraction = ''] = normalized.split('.');
  const minor = BigInt(whole) * BigInt(10 ** digits) + BigInt(fraction.padEnd(digits, '0'));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('金额超出可保存范围');
  return Number(minor);
}

export default function NewContractForm({ projects, onClose }: { projects: TaskCard[]; onClose: () => void }): React.JSX.Element {
  const createContract = useContractStore((state) => state.createContract);
  const notify = useWorkspaceStore((state) => state.notify);
  const [fullName, setFullName] = useState(''); const [shortName, setShortName] = useState('');
  const [supplierName, setSupplierName] = useState(''); const [contractNo, setContractNo] = useState('');
  const [amount, setAmount] = useState(''); const [currency, setCurrency] = useState('CNY');
  const [projectId, setProjectId] = useState(''); const [signedOn, setSignedOn] = useState('');
  const [effectiveOn, setEffectiveOn] = useState(''); const [expiresOn, setExpiresOn] = useState('');
  const [status, setStatus] = useState<'draft' | 'active'>('draft');
  const [scanPath, setScanPath] = useState(''); const [scanTitle, setScanTitle] = useState('合同扫描件');
  const [relatedUrl, setRelatedUrl] = useState(''); const [relatedUrlTitle, setRelatedUrlTitle] = useState('');
  const [nodeType, setNodeType] = useState<ContractActionType>('acceptance'); const [nodeTitle, setNodeTitle] = useState('');
  const [nodeDueAt, setNodeDueAt] = useState(''); const [nodeRemindAt, setNodeRemindAt] = useState('');
  const [initialActions, setInitialActions] = useState<ContractInitialActionInput[]>([]);
  const [nodeError, setNodeError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);

  const currentNode = (): ContractInitialActionInput | null => {
    if (!nodeTitle.trim()) return null;
    const dueAtUtc = nodeDueAt ? new Date(nodeDueAt).toISOString() : null;
    const remindAtUtc = nodeRemindAt ? new Date(nodeRemindAt).toISOString() : null;
    if (remindAtUtc && Date.parse(remindAtUtc) <= Date.now()) throw new Error('节点提醒时间必须晚于当前时间');
    if (dueAtUtc && remindAtUtc && remindAtUtc > dueAtUtc) throw new Error('节点提醒时间不能晚于计划完成时间');
    return { type: nodeType, title: nodeTitle.trim(), description: '', dueAtUtc, amountMinor: null, remindAtUtc };
  };

  const addInitialNode = () => {
    setNodeError(null);
    if (initialActions.length >= 12) { setNodeError('新建时最多先录入 12 个节点，创建后仍可继续添加'); return; }
    try {
      const node = currentNode();
      if (!node) { setNodeError('请填写节点名称'); return; }
      setInitialActions((current) => [...current, node]);
      setNodeTitle(''); setNodeDueAt(''); setNodeRemindAt('');
    } catch (reason) { setNodeError(reason instanceof Error ? reason.message : String(reason)); }
  };

  const save = async () => {
    if (saving) return;
    setSaving(true); setError(null);
    let amountMinor: number | null;
    try { amountMinor = amountToMinor(amount, currency); } catch (reason) { setSaving(false); setError(reason instanceof Error ? reason.message : String(reason)); return; }
    let pendingActions = initialActions;
    try {
      const pendingNode = currentNode();
      if (pendingNode) pendingActions = [...pendingActions, pendingNode];
    } catch (reason) { setSaving(false); setNodeError(reason instanceof Error ? reason.message : String(reason)); return; }
    const initialLinks: ContractLinkInput[] = [];
    if (scanPath.trim()) initialLinks.push({ kind: 'file', title: scanTitle.trim() || '合同扫描件', target: scanPath.trim() });
    if (relatedUrl.trim()) initialLinks.push({ kind: 'url', title: relatedUrlTitle.trim() || '附属链接', target: relatedUrl.trim() });
    const input: ContractCreateRequest = {
      procurementProjectId: projectId || null, fullName, shortName, contractNo, supplierName, amountMinor, currency,
      signedOn: signedOn || null, effectiveOn: effectiveOn || null, expiresOn: expiresOn || null,
      tzId: Intl.DateTimeFormat().resolvedOptions().timeZone, status, initialLinks, initialActions: pendingActions
    };
    const result = await createContract(input); setSaving(false);
    if (result) { setError(result); return; }
    notify('合同台账已创建', 'success'); onClose();
  };

  const valid = Boolean(fullName.trim() || shortName.trim());
  return <Dialog open title="新建合同" description="先记录合同核心信息、扫描件和首批节点；不完整时也可以建立草拟卡片。" onClose={onClose}
    actions={<><Button variant="ghost" disabled={saving} onClick={onClose}>取消</Button><Button icon={FileSignature} variant="primary" disabled={saving || !valid} onClick={() => void save()}>{saving ? '正在创建' : '创建合同'}</Button></>}>
    <div className="new-task-form contract-form-grid">
      <Field label="合同正式全名" value={fullName} autoFocus maxLength={500} hint="与卡片简称至少填写一项" placeholder="例如：总部办公电脑框架协议采购合同" onChange={(event) => setFullName(event.target.value)} />
      <Field label="合同卡片简称" value={shortName} maxLength={24} hint="可留空并从正式全名自动生成，最多 24 个字符" placeholder="例如：总部电脑框采合同" onChange={(event) => setShortName(event.target.value)} />
      <Field label="供应商（可稍后补充）" value={supplierName} maxLength={300} onChange={(event) => setSupplierName(event.target.value)} />
      <Field label="合同号" value={contractNo} maxLength={100} onChange={(event) => setContractNo(event.target.value)} />
      <div className="form-split"><Field label={`合同金额（${currency}）`} value={amount} inputMode="decimal" placeholder="123456.78" onChange={(event) => setAmount(event.target.value)} /><Field label="币种" value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></div>
      <label className="ui-field"><span className="ui-field-label">关联采购项目</span><span className="ui-field-control"><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">独立合同（不关联项目）</option>{projects.filter((card) => card.task.kind !== 'misc').map((card) => <option key={card.task.id} value={card.task.id}>{card.task.fullName}</option>)}</select></span></label>
      <div className="form-split"><Field label="签署日期" type="date" value={signedOn} onChange={(event) => setSignedOn(event.target.value)} /><Field label="生效日期" type="date" value={effectiveOn} onChange={(event) => setEffectiveOn(event.target.value)} /><Field label="到期日期" type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} /></div>
      <label className="ui-field"><span className="ui-field-label">初始状态</span><span className="ui-field-control"><select value={status} onChange={(event) => setStatus(event.target.value as 'draft' | 'active')}><option value="active">履约中</option><option value="draft">草拟</option></select></span></label>
      <fieldset className="contract-setup-block contract-material-setup"><legend>合同扫描件与附属链接</legend><p>扫描件使用本机磁盘绝对路径，例如 C:\采购项目\合同扫描件.pdf；打开前仍会展示完整地址并要求确认。</p>
        <Field label="合同扫描件绝对路径" aria-label="合同扫描件绝对路径" value={scanPath} maxLength={2048} placeholder="C:\采购项目\合同扫描件.pdf" onChange={(event) => setScanPath(event.target.value)} />
        <Field label="扫描件名称" value={scanTitle} maxLength={200} placeholder="合同扫描件" onChange={(event) => setScanTitle(event.target.value)} />
        <Field label="附属链接" value={relatedUrl} maxLength={2048} inputMode="url" placeholder="https://..." onChange={(event) => setRelatedUrl(event.target.value)} />
        <Field label="链接名称" value={relatedUrlTitle} maxLength={200} placeholder="例如：电子合同平台" onChange={(event) => setRelatedUrlTitle(event.target.value)} />
      </fieldset>
      <fieldset className="contract-setup-block"><legend>首批合同节点</legend><p>可以连续加入多个付款、交付、验收或归档节点，并为每个节点设置独立提醒。</p>
        {initialActions.length > 0 && <ul className="contract-initial-node-list">{initialActions.map((node, index) => <li key={`${node.type}-${node.title}-${index}`}><span><strong>{node.title}</strong><small>{CONTRACT_ACTION_LABELS[node.type]}{node.dueAtUtc ? ` · ${new Date(node.dueAtUtc).toLocaleString('zh-CN', { hour12: false })}` : ' · 未设置时间'}{node.remindAtUtc ? ' · 已设提醒' : ''}</small></span><IconButton icon={Trash2} variant="danger" label={`移除节点${node.title}`} onClick={() => setInitialActions((current) => current.filter((_, itemIndex) => itemIndex !== index))} /></li>)}</ul>}
        <div className="contract-initial-node-composer"><label className="ui-field"><span className="ui-field-label">节点类型</span><span className="ui-field-control"><select aria-label="首批合同节点类型" value={nodeType} onChange={(event) => setNodeType(event.target.value as ContractActionType)}>{Object.entries(CONTRACT_ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></span></label><Field label="节点名称" value={nodeTitle} maxLength={200} placeholder="例如：完成最终验收" onChange={(event) => setNodeTitle(event.target.value)} /><Field label="计划完成时间" type="datetime-local" value={nodeDueAt} onChange={(event) => setNodeDueAt(event.target.value)} /><Field label="提醒时间" type="datetime-local" value={nodeRemindAt} onChange={(event) => setNodeRemindAt(event.target.value)} /><Button icon={Plus} disabled={!nodeTitle.trim()} onClick={addInitialNode}>加入节点</Button></div>
        {nodeError && <AsyncFeedback tone="error" message={nodeError} />}
      </fieldset>
      {error && <AsyncFeedback tone="error" message={error} onRetry={() => void save()} />}
    </div>
  </Dialog>;
}
