// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskCard as TaskCardData, TaskNode } from '../src/shared/types';
import Carousel from '../src/renderer/src/components/Carousel';
import TaskCard from '../src/renderer/src/components/TaskCard';
import Timeline from '../src/renderer/src/components/Timeline';
import { Button } from '../src/renderer/src/components/ui/Button';
import { Dialog } from '../src/renderer/src/components/ui/Dialog';

const CARD: TaskCardData = {
  task: {
    id: 'task-1',
    name: '办公电脑采购',
    description: '',
    kind: 'task',
    urgency: 'high',
    deadlineUtc: '2026-08-20T08:00:00.000Z',
    tzId: 'Asia/Shanghai',
    status: 'active',
    createdAtUtc: '2026-08-16T00:00:00.000Z',
    updatedAtUtc: '2026-08-16T00:00:00.000Z',
    archivedAt: null,
    archiveOutcome: null
  },
  progress: { done: 1, total: 3, nextTitle: '确认技术参数' },
  nodes: [
    { id: 'node-1', title: '确认需求', status: 'completed', position: 0 },
    { id: 'node-2', title: '确认技术参数', status: 'in_progress', position: 1 },
    { id: 'node-3', title: '签订合同', status: 'pending', position: 2 }
  ],
  overdue: false
};

const NODES: TaskNode[] = [
  {
    id: 'node-1',
    taskId: 'task-1',
    title: '确认需求',
    description: '',
    startUtc: null,
    endUtc: null,
    status: 'pending',
    position: 0
  }
];

beforeEach(() => {
  class TestResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));

  HTMLDialogElement.prototype.showModal = function showModal(): void {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(): void {
    this.removeAttribute('open');
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('P9 核心界面控件', () => {
  it('任务凭条是可聚焦按钮并优先朗读下一动作', async () => {
    const onOpen = vi.fn();
    render(<TaskCard card={CARD} onOpen={onOpen} onNodeStatus={async () => undefined} onTaskAction={() => undefined} />);

    const card = screen.getByRole('button', { name: /下一步：确认技术参数/ });
    expect(card.tagName).toBe('BUTTON');
    expect(card.textContent).not.toContain('下一采购动作');
    expect(card.textContent).toContain('办公电脑采购');
    expect(card.textContent).toContain('确认技术参数');
    await userEvent.click(card);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('采购凭条节点轴支持四态显式选择', async () => {
    const onNodeStatus = vi.fn(async () => undefined);
    render(<TaskCard card={CARD} onOpen={() => undefined} onNodeStatus={onNodeStatus} onTaskAction={() => undefined} />);

    const select = screen.getByRole('combobox', { name: '确认技术参数的状态' });
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toContain('已取消');
    await userEvent.selectOptions(select, 'cancelled');
    expect(onNodeStatus).toHaveBeenCalledWith('task-1', 'node-2', 'cancelled');
  });

  it('采购凭条右上角菜单提供完成、取消和永久删除', async () => {
    const onTaskAction = vi.fn();
    render(<TaskCard card={CARD} onOpen={() => undefined} onNodeStatus={async () => undefined} onTaskAction={onTaskAction} />);

    await userEvent.click(screen.getByRole('button', { name: '管理任务：办公电脑采购' }));
    expect(screen.getByRole('button', { name: '完成并归档' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '取消并归档' })).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '永久删除' }));
    expect(onTaskAction).toHaveBeenCalledWith('delete');
  });

  it('节点状态只能通过显式选择改变', () => {
    const onStatus = vi.fn();
    const { container } = render(<Timeline nodes={NODES} editable onStatus={onStatus} />);

    fireEvent.click(screen.getByText('确认需求'));
    expect(onStatus).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox', { name: '确认需求的状态' }), { target: { value: 'in_progress' } });
    expect(onStatus).toHaveBeenCalledWith('node-1', 'in_progress');
    expect(container.querySelector('select')).not.toBeNull();
  });

  it('轮播支持方向键与 Home、End 定位', async () => {
    function Harness(): React.JSX.Element {
      const [active, setActive] = useState(0);
      return (
        <Carousel itemWidth={248} gap={12} activeIndex={active} onActiveIndexChange={setActive}>
          {[0, 1, 2].map((index) => (
            <button key={index} type="button" data-carousel-card="true" tabIndex={index === active ? 0 : -1}>任务 {index + 1}</button>
          ))}
        </Carousel>
      );
    }

    render(<Harness />);
    const first = screen.getByRole('button', { name: '任务 1' });
    first.focus();
    await userEvent.keyboard('{ArrowRight}');
    await new Promise((resolve) => window.setTimeout(resolve, 5));
    expect(document.activeElement?.textContent).toBe('任务 2');
    await userEvent.keyboard('{End}');
    await new Promise((resolve) => window.setTimeout(resolve, 5));
    expect(document.activeElement?.textContent).toBe('任务 3');
    await userEvent.keyboard('{Home}');
    await new Promise((resolve) => window.setTimeout(resolve, 5));
    expect(document.activeElement?.textContent).toBe('任务 1');
  });

  it('减少动画时轮播定位不启动 RAF 补间', async () => {
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    function Harness(): React.JSX.Element {
      const [active, setActive] = useState(0);
      return (
        <Carousel itemWidth={248} gap={12} activeIndex={active} onActiveIndexChange={setActive} reducedMotion>
          {[0, 1].map((index) => <button key={index} type="button" data-carousel-card="true">任务 {index + 1}</button>)}
        </Carousel>
      );
    }
    render(<Harness />);
    screen.getByRole('button', { name: '任务 1' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(raf).not.toHaveBeenCalled();
  });

  it('对话框关闭后恢复触发按钮焦点', async () => {
    function Harness(): React.JSX.Element {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>打开确认</Button>
          <Dialog open={open} title="确认操作" onClose={() => setOpen(false)} actions={<Button onClick={() => setOpen(false)}>确认</Button>}>
            <p>对话框内容</p>
          </Dialog>
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: '打开确认' });
    await userEvent.click(trigger);
    expect(screen.getByRole('dialog').hasAttribute('open')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: '关闭' }));
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    expect(document.activeElement).toBe(trigger);
  });

  it('核心任务凭条没有 serious 或 critical 的 axe 问题', async () => {
    const { container } = render(<main><TaskCard card={CARD} onOpen={() => undefined} onNodeStatus={async () => undefined} onTaskAction={() => undefined} /></main>);
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    const blocking = result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
    expect(blocking).toEqual([]);
  });
});
