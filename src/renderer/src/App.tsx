import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { IslandLevel, IslandState, IslandTransitionState, UiPreferences } from '../../shared/types';
import { designTokenCssVariables } from '../../shared/designTokens';
import { computeShellTransform, isExpanding } from '../../shared/transition';
import L1Strip from './panels/L1Strip';
import L2Panel from './panels/L2Panel';
import L3Panel from './panels/L3Panel';
import { ToastHost } from './components/ui/ToastHost';
import { useTaskStore } from './state/useStore';
import { useWorkspaceStore } from './state/useWorkspaceStore';

const INITIAL_PREFERENCES: UiPreferences = {
  colorScheme: 'dark',
  highContrast: false,
  reducedMotion: false,
  backdropMode: 'fallback',
  renderMode: 'software'
};

function radiusFor(level: IslandLevel): string {
  if (level === 'l1') return 'var(--radius-collapsed)';
  if (level === 'l2') return 'var(--radius-l2)';
  return 'var(--radius-l3)';
}

function renderLevel(level: IslandLevel, reducedMotion: boolean, layoutWidth?: number): React.JSX.Element {
  if (level === 'l1') return <L1Strip />;
  if (level === 'l2') return <L2Panel reducedMotion={reducedMotion} />;
  return <L3Panel layoutWidth={layoutWidth} />;
}

function renderTransitionTarget(level: IslandLevel, selectedTaskName: string): React.JSX.Element {
  if (level === 'l1') return <L1Strip />;
  return (
    <div className={'panel transition-preview-panel ' + (level === 'l2' ? 'l2-panel' : 'l3-panel')}>
      <span className="brand-mark" aria-hidden="true" />
      <span>{level === 'l2' ? '采购任务速览' : '当前任务工作台'}</span>
      <strong>{selectedTaskName}</strong>
    </div>
  );
}

function motionStyle(transition: IslandTransitionState, started: boolean): CSSProperties {
  const expanding = isExpanding(transition.fromBounds, transition.toBounds);
  const container = expanding ? transition.toBounds : transition.fromBounds;
  const visual = started ? transition.toBounds : transition.fromBounds;
  const transform = computeShellTransform(container, visual);
  const useTransform = transition.renderMode === 'composited';
  return {
    width: container.width + 'px',
    height: container.height + 'px',
    transform: useTransform
      ? `translate3d(${transform.translateX}px, ${transform.translateY}px, 0) scale(${transform.scaleX}, ${transform.scaleY})`
      : 'none',
    borderRadius: started ? radiusFor(transition.to) : radiusFor(transition.from),
    '--island-transition-duration': transition.durationMs + 'ms'
  } as CSSProperties;
}

export default function App(): React.JSX.Element {
  const [level, setLevel] = useState<IslandLevel>('l1');
  const [backdrop, setBackdrop] = useState<IslandState['backdrop']>('fallback');
  const [transition, setTransition] = useState<IslandTransitionState | null>(null);
  const [startedTransitionId, setStartedTransitionId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<UiPreferences>(INITIAL_PREFERENCES);
  const completedTransition = useRef<IslandTransitionState | null>(null);
  const ensureLoaded = useTaskStore((state) => state.ensureLoaded);
  const ensureOnboarded = useTaskStore((state) => state.ensureOnboarded);
  const openDetail = useTaskStore((state) => state.openDetail);
  const selectedTaskId = useWorkspaceStore((state) => state.selectedTaskId);
  const openTask = useWorkspaceStore((state) => state.openTask);
  const highlightNode = useWorkspaceStore((state) => state.highlightNode);
  const notify = useWorkspaceStore((state) => state.notify);
  const selectedTaskName = useTaskStore((state) => state.tasks.find((card) => card.task.id === selectedTaskId)?.task.name ?? '当前任务');

  useEffect(() => {
    void ensureLoaded();
    void ensureOnboarded();
  }, [ensureLoaded, ensureOnboarded]);

  useEffect(() => window.api.onReminderEvent((event) => {
    if (event.type === 'fallback') {
      notify(event.message, 'info');
      return;
    }
    openTask(event.taskId, 'nodes');
    highlightNode(event.nodeId);
    void openDetail(event.taskId);
  }), [highlightNode, notify, openDetail, openTask]);

  useEffect(() => {
    let active = true;
    void window.api.getState().then((state) => {
      if (!active) return;
      setLevel(state.level);
      setBackdrop(state.backdrop);
      setTransition(state.transition);
    });
    void window.api.getUiPreferences().then((next) => { if (active) setPreferences(next); });
    const offState = window.api.onState((state) => {
      setLevel(state.level);
      setBackdrop(state.backdrop);
      setTransition(state.transition);
    });
    const offTransition = window.api.onTransition(setTransition);
    const offPreferences = window.api.onUiPreferences(setPreferences);
    return () => {
      active = false;
      offState();
      offTransition();
      offPreferences();
    };
  }, []);

  useEffect(() => {
    if (!transition) {
      setStartedTransitionId(null);
      return;
    }
    completedTransition.current = transition;
    if (transition.phase === 'preparing') {
      setStartedTransitionId(null);
      const frame = requestAnimationFrame(() => void window.api.transitionReady(transition.id));
      return () => cancelAnimationFrame(frame);
    }
    if (transition.phase !== 'animating') return;
    const startFrame = requestAnimationFrame(() => setStartedTransitionId(transition.id));
    const finishTimer = window.setTimeout(
      () => void window.api.transitionFinished(transition.id),
      Math.max(1, transition.durationMs)
    );
    return () => {
      cancelAnimationFrame(startFrame);
      window.clearTimeout(finishTimer);
    };
  }, [transition]);

  useEffect(() => {
    if (transition) return;
    const completed = completedTransition.current;
    if (!completed || completed.to !== level || completed.reason !== 'level') return;
    completedTransition.current = null;
    if (!document.hasFocus()) return;
    requestAnimationFrame(() => {
      if (level === 'l3') {
        document.querySelector<HTMLElement>('[data-transition-focus="l3"]')?.focus();
      } else if (level === 'l2' && completed.from === 'l3') {
        const selector = selectedTaskId
          ? `[data-carousel-card="true"][data-task-id="${CSS.escape(selectedTaskId)}"]`
          : '[data-carousel-card="true"]';
        document.querySelector<HTMLElement>(selector)?.focus();
      }
    });
  }, [level, selectedTaskId, transition]);

  const tokenStyle = useMemo(
    () => designTokenCssVariables(preferences.colorScheme) as CSSProperties,
    [preferences.colorScheme]
  );

  const handleEsc = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
      const effectiveLevel = transition?.to ?? level;
      void window.api.setLevel(effectiveLevel === 'l3' ? 'l2' : 'l1');
    }
  }, [level, transition?.to]);

  useEffect(() => {
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [handleEsc]);

  const motionStarted = transition !== null && startedTransitionId === transition.id;
  const shellStyle = transition
    ? transition.phase === 'preparing'
      ? ({ borderRadius: radiusFor(transition.from), '--island-transition-duration': transition.durationMs + 'ms' } as CSSProperties)
      : motionStyle(transition, motionStarted)
    : undefined;
  const differentLevels = transition !== null && transition.from !== transition.to;
  const deferL3Mount = transition?.to === 'l3' && transition.from !== 'l3';
  const freezeLargeExpansion = deferL3Mount && transition?.phase === 'preparing';
  const suppressTransitionSource = transition !== null
    && differentLevels
    && (isExpanding(transition.fromBounds, transition.toBounds) || transition.phase === 'settling');

  return (
    <div
      className={'app level-' + level + ' backdrop-' + backdrop}
      data-theme={preferences.colorScheme}
      data-high-contrast={preferences.highContrast ? 'true' : 'false'}
      data-reduced-motion={preferences.reducedMotion ? 'true' : 'false'}
      data-render-mode={transition?.renderMode ?? preferences.renderMode}
      data-transitioning={transition ? 'true' : 'false'}
      style={tokenStyle}
      onPointerDown={() => void window.api.activate()}
    >
      <div className={'island-motion-stage' + (freezeLargeExpansion ? ' layout-frozen' : '')} aria-busy={transition ? 'true' : 'false'} inert={transition ? true : undefined}>
        <div
          className={'island-motion-shell' + (motionStarted ? ' motion-started' : '')}
          data-transition-phase={transition?.phase ?? 'idle'}
          style={shellStyle}
        >
          <div
            className={'island-transition-layer island-transition-source' + (suppressTransitionSource ? ' source-suppressed' : '')}
            aria-hidden={differentLevels && motionStarted ? 'true' : undefined}
          >
            {renderLevel(
              transition?.from ?? level,
              preferences.reducedMotion,
              transition?.fromBounds.width
            )}
          </div>
          {differentLevels ? (
              <div className="island-transition-layer island-transition-target" aria-hidden={!motionStarted ? 'true' : undefined}>
                {renderTransitionTarget(transition.to, selectedTaskName)}
              </div>
          ) : null}
        </div>
      </div>
      <ToastHost />
    </div>
  );
}
