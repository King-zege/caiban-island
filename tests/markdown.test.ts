import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import ReactMarkdown from 'react-markdown';

describe('Markdown 安全渲染', () => {
  it('原始 HTML/脚本被转义为纯文本，不产生可执行标签', () => {
    const html = renderToStaticMarkup(
      React.createElement(ReactMarkdown, null, '正常文本 <script>alert(1)</script> <img src=x onerror=alert(2)>')
    );
    // 不允许出现任何真实的 script/img 标签（原始 HTML 必须被转义成文本）
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img'); // 真实标签已消除，属性无法执行
    // 原始内容以转义文本形式保留
    expect(html).toContain('正常文本');
    expect(html).toContain('&lt;script&gt;');
  });

  it('常用语法正常渲染', () => {
    const html = renderToStaticMarkup(
      React.createElement(ReactMarkdown, null, '# 标题\n\n**加粗** 和 [链接](https://example.com)')
    );
    expect(html).toContain('标题');
    expect(html).toContain('<strong');
    expect(html).toContain('href="https://example.com"');
  });
});
