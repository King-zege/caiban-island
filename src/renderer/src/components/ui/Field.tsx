import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string | null;
  trailing?: ReactNode;
}

export function Field({ label, hint, error, trailing, id, className = '', ...props }: FieldProps): React.JSX.Element {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const describedBy = error ? fieldId + '-error' : hint ? fieldId + '-hint' : undefined;
  return (
    <label className={'ui-field' + (className ? ' ' + className : '')} htmlFor={fieldId}>
      <span className="ui-field-label">{label}</span>
      <span className="ui-field-control">
        <input id={fieldId} aria-invalid={error ? 'true' : undefined} aria-describedby={describedBy} {...props} />
        {trailing}
      </span>
      {error ? <span id={fieldId + '-error'} className="ui-field-error">{error}</span> : hint ? <span id={fieldId + '-hint'} className="ui-field-hint">{hint}</span> : null}
    </label>
  );
}
