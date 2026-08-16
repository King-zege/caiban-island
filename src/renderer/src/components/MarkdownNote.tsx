import { useState } from 'react';
import ReactMarkdown from 'react-markdown';

const PLACEHOLDER = [
  '支持 Markdown：# 标题、**加粗**、- 列表、[链接](https://example.com)',
  '例如：',
  '- 供应商A 报价已收到',
  '- 需在周五前确认付款方式'
].join(String.fromCharCode(10));

export default function MarkdownNote({ body, onChange, onOpenExternal }: { body: string; onChange: (v: string) => void; onOpenExternal?: (target: string) => void }): React.JSX.Element {
  const [preview, setPreview] = useState(false);
  return (
    <div className="markdown-note">
      <div className="note-toolbar">
        <button className={'chip-btn' + (!preview ? ' active' : '')} onClick={() => setPreview(false)}>
          编辑
        </button>
        <button className={'chip-btn' + (preview ? ' active' : '')} onClick={() => setPreview(true)}>
          预览
        </button>
      </div>
      {preview ? (
        <div className="markdown-preview">
          <ReactMarkdown
            components={{
              a: ({ href, children }) => (
                <button type="button" className="markdown-link" title={href} onClick={() => href && onOpenExternal?.(href)}>{children}</button>
              )
            }}
          >{body || '_（空）_'}</ReactMarkdown>
        </div>
      ) : (
        <textarea
          className="note-textarea"
          value={body}
          placeholder={PLACEHOLDER}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
