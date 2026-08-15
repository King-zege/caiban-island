import { useState } from 'react';

// FR-001/FR-002：首次启动引导——说明本地存储/托盘/Qoder/免证书，并询问开机自启
export default function WelcomeView({ onDone }: { onDone: () => void }): React.JSX.Element {
  const [step, setStep] = useState<'intro' | 'autostart'>('intro');

  const chooseAutostart = (v: boolean) => {
    void window.api.setSetting('autostart', v ? '1' : '0');
    void window.api.setSetting('onboarded', '1');
    onDone();
  };

  const skip = () => {
    void window.api.setSetting('onboarded', '1');
    onDone();
  };

  return (
    <div className="welcome-view">
      <h2 className="welcome-title">欢迎使用采办岛</h2>
      {step === 'intro' ? (
        <>
          <ul className="welcome-list">
            <li>
              <b>数据在本机</b>：任务、节点、链接与备注保存在 %APPDATA%\caiban-island\（绿色免安装，删除该目录即清除全部数据）。
            </li>
            <li>
              <b>AI 拆分可选</b>：可在设置中配置 Qoder MCP（推荐）或内置 AI；AI 只生成草稿，由你逐节点审核确认后才生效。
            </li>
            <li>
              <b>常驻托盘</b>：收起面板不退出应用；托盘图标提供"打开 / 暂停 / 退出"。
            </li>
            <li>
              <b>免证书绿色版</b>：首次运行 SmartScreen 提示"仍要运行"是正常现象，并非病毒。
            </li>
          </ul>
          <div className="welcome-actions">
            <button className="btn primary" onClick={() => setStep('autostart')}>
              下一步
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="welcome-q">是否随 Windows 登录自动启动？</p>
          <div className="welcome-actions">
            <button className="btn primary" onClick={() => chooseAutostart(true)}>
              是，开机自启
            </button>
            <button className="btn" onClick={() => chooseAutostart(false)}>
              否
            </button>
            <button className="btn" onClick={skip}>
              稍后再说
            </button>
          </div>
        </>
      )}
    </div>
  );
}
