import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { IslandLevel, IslandState, UiPreferences } from '../../shared/types';
import { designTokenCssVariables } from '../../shared/designTokens';
import L1Strip from './panels/L1Strip';
import L2Panel from './panels/L2Panel';
import L3Panel from './panels/L3Panel';

export default function App(): React.JSX.Element {
  const [level, setLevel] = useState<IslandLevel>('l1');
  const [backdrop, setBackdrop] = useState<IslandState['backdrop']>('fallback');
  const [preferences, setPreferences] = useState<UiPreferences>({
    colorScheme: 'dark',
    highContrast: false,
    reducedMotion: false,
    backdropMode: 'fallback'
  });

  useEffect(() => {
    window.api.getState().then((s) => {
      setLevel(s.level);
      setBackdrop(s.backdrop);
    });
    window.api.getUiPreferences().then(setPreferences);
    window.api.onState((s) => {
      setLevel(s.level);
      setBackdrop(s.backdrop);
    });
    window.api.onUiPreferences(setPreferences);
  }, []);

  const tokenStyle = useMemo(
    () => designTokenCssVariables(preferences.colorScheme) as CSSProperties,
    [preferences.colorScheme]
  );

  const handleEsc = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      void window.api.setLevel(level === 'l3' ? 'l2' : 'l1');
    }
  }, [level]);

  useEffect(() => {
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [handleEsc]);

  return (
    <div
      className={'app level-' + level + ' backdrop-' + backdrop}
      data-theme={preferences.colorScheme}
      data-high-contrast={preferences.highContrast ? 'true' : 'false'}
      data-reduced-motion={preferences.reducedMotion ? 'true' : 'false'}
      style={tokenStyle}
      onPointerDown={() => void window.api.activate()}
    >
      {level === 'l1' && <L1Strip />}
      {level === 'l2' && <L2Panel />}
      {level === 'l3' && <L3Panel />}
    </div>
  );
}
