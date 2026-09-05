import { Check, ChevronLeft, Clipboard, ExternalLink, Link2, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent } from 'react';
import type { FeishuBotErrorCategory, FeishuBotStatus, FeishuPairingCode } from '../../../shared/types';
import { AsyncFeedback } from './ui/AsyncFeedback';
import { Button, IconButton } from './ui/Button';
import { ExternalTargetDialog } from './ui/ExternalTargetDialog';
import type { ExternalTarget } from './ui/ExternalTargetDialog';
import { Field } from './ui/Field';

type WizardStep = 'intro' | 'credentials' | 'connection' | 'checklist' | 'pairing' | 'complete';

const STEPS: WizardStep[] = ['intro', 'credentials', 'connection', 'checklist', 'pairing', 'complete'];
const STEP_LABELS: Record<WizardStep, string> = {
  intro: '开始', credentials: '凭据', connection: '连接', checklist: '后台配置', pairing: '配对', complete: '完成'
};

const CHECKLIST_ITEMS: Array<{ id: string; label: string; page: 'bot' | 'event' | 'auth' | 'version' | null; title: string }> = [
  { id: 'bot', label: '启用机器人能力', page: 'bot', title: '机器人能力' },
  { id: 'event', label: '事件订阅选择“使用长连接接收事件”', page: 'event', title: '事件与回调' },
  { id: 'auth', label: '开通接收消息与机器人发消息权限', page: 'auth', title: '权限管理' },
  { id: 'version', label: '创建并发布新版本', page: 'version', title: '版本管理' },
  { id: 'scope', label: '可用范围包含使用者，并把机器人加入目标群聊', page: null, title: '可用范围' }
];

interface Diagnosis {
  title: string;
  detail: string;
  link: 'baseinfo' | 'event' | 'auth' | 'bot' | null;
}

const DIAGNOSES: Record<FeishuBotErrorCategory, Diagnosis> = {
  credentials: { title: 'App ID 或 App Secret 无效', detail: '重新复制凭证；如果 Secret 已重置，需要粘贴新值再连接。', link: 'baseinfo' },
  decryption: { title: '这台电脑无法解密已保存的 Secret', detail: '加密凭据不能跨 Windows 用户或设备迁移，请在当前电脑重新填写 App Secret。', link: 'baseinfo' },
  long_connection: { title: '尚未启用长连接事件订阅', detail: '在事件与回调页选择“使用长连接接收事件”，然后发布新版本。', link: 'event' },
  permission: { title: '机器人缺少消息权限', detail: '开通接收消息与以机器人身份发送消息权限，发布版本后再重试。', link: 'auth' },
  bot_disabled: { title: '尚未启用机器人能力', detail: '长连接已经建立，但没有读取到机器人身份。请启用机器人并发布新版本。', link: 'bot' },
  rate_limit: { title: '飞书暂时限制了请求频率', detail: '稍等片刻再立即重连；无需重新填写凭据。', link: null },
  network: { title: '网络或 WebSocket 连接失败', detail: '检查网络、代理和防火墙；采办岛会按 5 秒、15 秒、60 秒自动重试。', link: null },
  provider: { title: '飞书服务返回了异常响应', detail: '先重试；如果持续失败，请开启诊断日志后导出元信息。', link: null }
};

export function feishuDiagnosis(status: FeishuBotStatus): Diagnosis | null {
  return status.lastErrorCategory ? DIAGNOSES[status.lastErrorCategory] : null;
}

function developerUrl(appId: string, page: 'baseinfo' | 'event' | 'auth' | 'bot' | 'version'): string {
  return `https://open.feishu.cn/app/${encodeURIComponent(appId)}/${page}`;
}

export function parseFeishuCredentialPaste(value: string): { appId?: string; appSecret?: string } {
  const appId = value.match(/\bcli_[A-Za-z0-9]+\b/u)?.[0];
  const labelledSecret = value.match(/App\s*Secret\s*[:：=]\s*([^\s]+)/iu)?.[1];
  const lines = value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const fallbackSecret = appId && lines.length > 1
    ? lines.map((line) => line.replace(/^.*?[:：=]\s*/u, '').trim()).find((line) => line !== appId && !line.includes('cli_'))
    : undefined;
  return { appId, appSecret: labelledSecret ?? fallbackSecret };
}

function remainingLabel(expiresAt: string, now: number): string {
  const remaining = Math.max(0, Date.parse(expiresAt) - now);
  if (remaining === 0) return '已过期';
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

interface FeishuSetupWizardProps {
  status: FeishuBotStatus;
  onStatusChange: (status: FeishuBotStatus) => void;
  onClose: () => void;
}

export default function FeishuSetupWizard({ status, onStatusChange, onClose }: FeishuSetupWizardProps): React.JSX.Element {
  const [step, setStep] = useState<WizardStep>('intro');
  const [appId, setAppId] = useState(status.appId);
  const [appSecret, setAppSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [pairingCode, setPairingCode] = useState<FeishuPairingCode | null>(null);
  const [now, setNow] = useState(Date.now());
  const [target, setTarget] = useState<ExternalTarget | null>(null);
  const [checks, setChecks] = useState<Record<string, boolean>>({ bot: false, event: false, auth: false, version: false, scope: false });
  const initialPairedCount = useMemo(() => status.pairedUsers.length, []);
  const index = STEPS.indexOf(step);
  const diagnosis = feishuDiagnosis(status);
  const appIdValid = /^cli_[A-Za-z0-9]+$/u.test(appId.trim()) && appId.trim().length <= 200;
  const secretAvailable = appSecret.trim().length > 0 || status.configured;

  useEffect(() => {
    if (!pairingCode) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [pairingCode]);

  useEffect(() => {
    if (step === 'pairing' && status.pairedUsers.length > initialPairedCount) {
      setFeedback({ tone: 'success', message: `已配对：${status.pairedUsers.at(-1)?.displayName ?? '飞书用户'}` });
      setStep('complete');
    }
  }, [initialPairedCount, status.pairedUsers, step]);

  const openDeveloperPage = (page: 'baseinfo' | 'event' | 'auth' | 'bot' | 'version', title: string) => {
    setTarget({ kind: 'url', target: developerUrl(appId.trim(), page), title });
  };

  const applyPaste = (event: ReactClipboardEvent<HTMLInputElement>) => {
    const parsed = parseFeishuCredentialPaste(event.clipboardData.getData('text'));
    if (!parsed.appId && !parsed.appSecret) return;
    event.preventDefault();
    if (parsed.appId) setAppId(parsed.appId);
    if (parsed.appSecret) setAppSecret(parsed.appSecret);
  };

  const connect = async () => {
    if (!appIdValid) { setFeedback({ tone: 'error', message: 'App ID 应以 cli_ 开头，且只包含字母和数字。' }); return; }
    if (!secretAvailable) { setFeedback({ tone: 'error', message: '请输入 App Secret。' }); return; }
    setBusy(true); setFeedback(null);
    const result = await window.api.saveFeishuAgentConfig({ appId: appId.trim(), appSecret: appSecret.trim(), enabled: true });
    setBusy(false); setAppSecret('');
    if (!result.ok) {
      setFeedback({ tone: 'error', message: result.error });
      setStep('connection');
      const refreshed = await window.api.getFeishuAgentStatus();
      if (refreshed.ok) onStatusChange(refreshed.data);
      return;
    }
    onStatusChange(result.data);
    setFeedback(result.data.connectionState === 'connected'
      ? { tone: 'success', message: `已连接${result.data.botName ? `：${result.data.botName}` : ''}` }
      : { tone: 'error', message: result.data.lastErrorMessage ?? '配置已保存，正在自动重连。' });
    setStep('connection');
  };

  const reconnect = async () => {
    setBusy(true); setFeedback(null);
    const result = await window.api.reconnectFeishuAgent();
    setBusy(false);
    if (result.ok) { onStatusChange(result.data); setFeedback({ tone: 'success', message: `已连接${result.data.botName ? `：${result.data.botName}` : ''}` }); }
    else setFeedback({ tone: 'error', message: result.error });
  };

  const generateCode = async () => {
    setBusy(true); setFeedback(null);
    const result = await window.api.generateFeishuPairingCode();
    setBusy(false);
    if (result.ok) { setPairingCode(result.data); setNow(Date.now()); }
    else setFeedback({ tone: 'error', message: result.error });
  };

  const copyBinding = async () => {
    if (!pairingCode) return;
    try {
      await navigator.clipboard.writeText(`/bind ${pairingCode.code}`);
      setFeedback({ tone: 'success', message: '配对指令已复制。' });
    } catch { setFeedback({ tone: 'error', message: '无法访问剪贴板，请手动复制配对指令。' }); }
  };

  const back = () => setStep(STEPS[Math.max(0, index - 1)]);

  return <section className="feishu-setup-wizard" aria-labelledby="feishu-wizard-title">
    <header className="feishu-wizard-head">
      <div><h3 id="feishu-wizard-title">连接你的飞书机器人</h3><p>约 5 分钟 · 可随时退出，已保存的配置不会丢失</p></div>
      <IconButton icon={X} label="退出连接向导" onClick={onClose} />
    </header>
    <ol className="feishu-wizard-progress" aria-label="连接进度">
      {STEPS.map((item, stepIndex) => <li key={item} className={stepIndex === index ? 'active' : stepIndex < index ? 'complete' : ''} aria-current={stepIndex === index ? 'step' : undefined}><span>{stepIndex < index ? <Check aria-hidden="true" size={13} /> : stepIndex + 1}</span><small>{STEP_LABELS[item]}</small></li>)}
    </ol>
    {feedback && <AsyncFeedback tone={feedback.tone} message={feedback.message} />}

    <div className="feishu-wizard-body">
      {step === 'intro' && <div className="feishu-wizard-copy"><Link2 aria-hidden="true" size={28} /><h4>用飞书对话操控同一个采办岛 Agent</h4><p>私聊直接派任务，群聊需要 @机器人。机器人与多维表格导出彼此独立，采办岛必须保持运行并联网。</p><p className="feishu-security-note"><ShieldCheck aria-hidden="true" size={17} />App Secret 只保存在本机，并由 Windows 系统级加密保护。</p></div>}

      {step === 'credentials' && <div className="feishu-wizard-fields"><Field label="App ID" aria-label="向导 App ID" value={appId} placeholder="cli_..." maxLength={200} hint={appId.length > 0 && !appIdValid ? '应以 cli_ 开头，且只包含字母和数字。' : '可直接粘贴飞书后台复制的 App ID 行或两行凭据。'} onPaste={applyPaste} onChange={(event) => setAppId(event.target.value)} /><Field label="App Secret" aria-label="向导 App Secret" type="password" value={appSecret} maxLength={8192} autoComplete="off" placeholder={status.configured ? '已保存；留空表示不修改' : '粘贴 App Secret'} onPaste={applyPaste} onChange={(event) => setAppSecret(event.target.value)} /><p className="feishu-security-note"><ShieldCheck aria-hidden="true" size={17} />Secret 不会返回到界面、写入日志或以明文进入数据库。</p></div>}

      {step === 'connection' && <div className="feishu-wizard-copy"><span className={`feishu-connection-orb ${status.connectionState}`} aria-hidden="true" /><h4>{status.connectionState === 'connected' ? `已连接${status.botName ? `：${status.botName}` : ''}` : status.connectionState === 'reconnecting' ? `正在重连（第 ${status.retryAttempt} 次）` : '还没有连通'}</h4>{diagnosis ? <div className="feishu-diagnosis"><strong>{diagnosis.title}</strong><p>{diagnosis.detail}</p>{status.lastErrorMessage && <small>{status.lastErrorMessage}</small>}{diagnosis.link && <Button icon={ExternalLink} onClick={() => openDeveloperPage(diagnosis.link!, diagnosis.title)}>打开飞书后台修复</Button>}</div> : <p>连接成功后仍需完成事件、权限和版本发布检查，才能正常收发消息。</p>}</div>}

      {step === 'checklist' && <div className="feishu-checklist">
        {CHECKLIST_ITEMS.map((item) => <div key={item.id}><label><input type="checkbox" checked={checks[item.id] ?? false} onChange={(event) => setChecks((current) => ({ ...current, [item.id]: event.target.checked }))} /><span>{item.label}</span></label>{item.page && <Button icon={ExternalLink} variant="ghost" onClick={() => openDeveloperPage(item.page!, item.title)}>打开</Button>}</div>)}
        <p><code>im.message.receive_v1</code> · <code>im:message:send_as_bot</code>。不需要公网回调地址，也不要申请附件下载或群内全部消息权限。</p>
      </div>}

      {step === 'pairing' && <div className="feishu-pairing-step"><h4>在飞书私聊中完成配对</h4><p>打开飞书，搜索 <strong>{status.botName ?? '你的机器人'}</strong>，在私聊中发送：</p>{pairingCode ? <><div className="feishu-pairing-command"><code>/bind {pairingCode.code}</code><IconButton icon={Clipboard} label="复制配对指令" onClick={() => void copyBinding()} /></div><p className={Date.parse(pairingCode.expiresAt) <= now ? 'expired' : ''}>剩余 {remainingLabel(pairingCode.expiresAt, now)}。每个配对码仅能使用一次。</p><Button icon={RefreshCw} disabled={busy} onClick={() => void generateCode()}>重新生成</Button></> : <Button icon={Link2} variant="primary" disabled={busy} onClick={() => void generateCode()}>{busy ? '正在生成' : '生成配对码'}</Button>}</div>}

      {step === 'complete' && <div className="feishu-wizard-copy"><Check aria-hidden="true" size={28} /><h4>飞书机器人已经可以使用</h4><p>{status.botName ?? '机器人'} · 已配对 {status.pairedUsers.length} 位用户。私聊直接派任务，群聊 @机器人。</p><div className="feishu-command-list"><code>/help</code><code>/new</code><code>/status</code><code>/cancel</code></div><p className="feishu-security-note"><ShieldCheck aria-hidden="true" size={17} />飞书发起的写操作始终发送审批卡；只有本次任务发起人可以处理。</p></div>}
    </div>

    <footer className="feishu-wizard-actions">
      {index > 0 && step !== 'complete' && <Button icon={ChevronLeft} variant="ghost" disabled={busy} onClick={back}>上一步</Button>}
      <span />
      {step === 'intro' && <><Button variant="ghost" onClick={onClose}>稍后设置</Button><Button variant="primary" onClick={() => setStep('credentials')}>开始连接</Button></>}
      {step === 'credentials' && <Button variant="primary" disabled={busy || !appIdValid || !secretAvailable} onClick={() => void connect()}>{busy ? '正在连接' : '保存并连接'}</Button>}
      {step === 'connection' && <><Button icon={RefreshCw} disabled={busy || !status.configured} onClick={() => void reconnect()}>{busy ? '正在重连' : '立即重连'}</Button><Button variant="primary" disabled={status.connectionState !== 'connected'} onClick={() => setStep('checklist')}>继续后台检查</Button></>}
      {step === 'checklist' && <Button variant="primary" disabled={!Object.values(checks).every(Boolean)} onClick={() => setStep('pairing')}>开始配对</Button>}
      {step === 'pairing' && status.pairedUsers.length > 0 && <Button variant="primary" onClick={() => setStep('complete')}>已有配对，继续</Button>}
      {step === 'complete' && <Button variant="primary" onClick={onClose}>完成</Button>}
    </footer>
    <ExternalTargetDialog target={target} onClose={() => setTarget(null)} />
  </section>;
}
