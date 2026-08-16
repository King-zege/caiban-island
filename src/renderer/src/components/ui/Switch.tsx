export function Switch({ checked, label, onChange, disabled = false }: { checked: boolean; label: string; onChange: (checked: boolean) => void; disabled?: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      className={'ui-switch' + (checked ? ' checked' : '')}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span aria-hidden="true" />
    </button>
  );
}
