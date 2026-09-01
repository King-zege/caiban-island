import { FileSignature } from 'lucide-react';
import { useState } from 'react';
import type { ContractCreateRequest } from '../../../shared/contractContracts';
import type { TaskCard } from '../../../shared/taskContracts';
import { useContractStore } from '../state/useContractStore';
import { useWorkspaceStore } from '../state/useWorkspaceStore';
import { AsyncFeedback } from './ui/AsyncFeedback';
import { Button } from './ui/Button';
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
  const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (saving) return;
    setSaving(true); setError(null);
    let amountMinor: number | null;
    try { amountMinor = amountToMinor(amount, currency); } catch (reason) { setSaving(false); setError(reason instanceof Error ? reason.message : String(reason)); return; }
    const input: ContractCreateRequest = {
      procurementProjectId: projectId || null, fullName, shortName, contractNo, supplierName, amountMinor, currency,
      signedOn: signedOn || null, effectiveOn: effectiveOn || null, expiresOn: expiresOn || null,
      tzId: Intl.DateTimeFormat().resolvedOptions().timeZone, status
    };
    const result = await createContract(input); setSaving(false);
    if (result) { setError(result); return; }
    notify('合同台账已创建', 'success'); onClose();
  };

  const valid = Boolean(fullName.trim() || shortName.trim());
  return <Dialog open title="新建合同" description="信息不完整也可以先建草拟卡片；正式全名、简称或供应商可在 L3 中继续补充。" onClose={onClose}
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
      {error && <AsyncFeedback tone="error" message={error} onRetry={() => void save()} />}
    </div>
  </Dialog>;
}
