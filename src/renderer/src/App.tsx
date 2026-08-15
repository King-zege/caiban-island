import { useCallback, useEffect, useState } from 'react';
import type { IslandLevel, IslandState } from '../../shared/types';
import L1Strip from './panels/L1Strip';
import L2Panel from './panels/L2Panel';
import L3Panel from './panels/L3Panel';

export default function App(): React.JSX.Element {
  const [level, setLevel] = useState<IslandLevel>('l1');
  const [backdrop, setBackdrop] = useState<IslandState['backdrop']>('fallback');

  useEffect(() => {
    window.api.getState().then((s) => {
      setLevel(s.level);
      setBackdrop(s.backdrop);
    });
    window.api.onState((s) => {
      setLevel(s.level);
      setBackdrop(s.backdrop);
    });
  }, []);

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
      onPointerDown={() => void window.api.activate()}
    >
      {level === 'l1' && <L1Strip />}
      {level === 'l2' && <L2Panel />}
      {level === 'l3' && <L3Panel />}
    </div>
  );
}
