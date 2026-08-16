import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: ReactNode }): React.JSX.Element {
  return (
    <div className="ui-empty-state">
      <span className="ui-empty-icon"><Icon aria-hidden="true" size={24} strokeWidth={1.6} /></span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
