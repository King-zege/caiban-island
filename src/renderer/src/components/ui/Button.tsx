import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: LucideIcon;
  children: ReactNode;
}

export function Button({ variant = 'secondary', icon: Icon, className = '', children, type = 'button', ...props }: ButtonProps): React.JSX.Element {
  return (
    <button type={type} className={'ui-button ' + variant + (className ? ' ' + className : '')} {...props}>
      {Icon && <Icon aria-hidden="true" size={18} strokeWidth={1.75} />}
      <span>{children}</span>
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  variant?: ButtonVariant;
}

export function IconButton({ icon: Icon, label, variant = 'ghost', className = '', type = 'button', ...props }: IconButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      className={'ui-icon-button ' + variant + (className ? ' ' + className : '')}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon aria-hidden="true" size={19} strokeWidth={1.75} />
    </button>
  );
}
