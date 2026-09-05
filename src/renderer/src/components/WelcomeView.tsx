import { Bell, Bot, Check, ShieldCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Button } from './ui/Button';

export default function WelcomeView({ onDone }: { onDone: (connectFeishu: boolean) => void }): React.JSX.Element {
  const [step, setStep] = useState<'intro' | 'autostart' | 'feishu'>('intro');
  const [autostart, setAutostart] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = async (connectFeishu: boolean) => {
    setBusy(true);
    setError(null);
    const [autostartResult, onboardResult] = await Promise.all([
      window.api.setSetting('autostart', autostart ? '1' : '0'),
      window.api.setSetting('onboarded', '1')
    ]);
    setBusy(false);
    if (!autostartResult.ok || !onboardResult.ok) {
      setError(!autostartResult.ok ? autostartResult.error : !onboardResult.ok ? onboardResult.error : '保存失败');
      return;
    }
    onDone(connectFeishu);
  };

  return (
    <div className="welcome-view">
      {step === 'intro' ? (
        <>
          <div className="welcome-copy">
            <span className="eyebrow">欢迎来到采办岛</span>
            <h2>把下一项采购动作放在眼前</h2>
          </div>
          <div className="welcome-principles">
            <span><ShieldCheck aria-hidden="true" size={19} /><strong>本机保存</strong><small>任务与资料留在你的电脑</small></span>
            <span><Sparkles aria-hidden="true" size={19} /><strong>写入受权限控制</strong><small>桌面与飞书都经过同一命令边界</small></span>
            <span><Bell aria-hidden="true" size={19} /><strong>常驻但不打扰</strong><small>收起后从顶部快速唤回</small></span>
          </div>
          <Button variant="primary" onClick={() => setStep('autostart')}>继续</Button>
        </>
      ) : step === 'autostart' ? (
        <div className="welcome-choice">
          <div>
            <span className="eyebrow">最后一步</span>
            <h2>登录 Windows 后自动启动？</h2>
            <p>开启后，采办岛会在顶部待命；你可以随时在设置里更改。</p>
          </div>
          <div className="welcome-actions">
            <Button icon={Check} variant="primary" disabled={busy} onClick={() => { setAutostart(true); setStep('feishu'); }}>自动启动</Button>
            <Button disabled={busy} onClick={() => { setAutostart(false); setStep('feishu'); }}>暂不启用</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setStep('intro')}>返回</Button>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
      ) : (
        <div className="welcome-choice">
          <div>
            <Bot aria-hidden="true" size={26} />
            <h2>要连接飞书机器人吗？</h2>
            <p>用 App ID 和 App Secret 即可开始；向导会带你完成后台权限和私聊配对，约 5 分钟。</p>
          </div>
          <div className="welcome-actions">
            <Button icon={Bot} variant="primary" disabled={busy} onClick={() => void finish(true)}>完成并连接飞书</Button>
            <Button disabled={busy} onClick={() => void finish(false)}>跳过，进入工作台</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setStep('autostart')}>返回</Button>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
