import { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, forwardRef } from 'react';
import { X } from 'lucide-react';

const fieldBase =
  'w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 transition-colors focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  onClear?: () => void;
  showClear?: boolean;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  ({ label, className, value, onChange, onClear, showClear = true, disabled, readOnly, type, ...props }, ref) => {
    const hasValue = value !== undefined && value !== null && String(value).length > 0;
    const canClear = showClear && hasValue && !disabled && !readOnly && type !== 'date';

    const handleClear = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (onClear) {
        onClear();
      } else if (onChange) {
        const syntheticEvent = {
          target: { value: type === 'number' ? '' : '' },
          currentTarget: { value: type === 'number' ? '' : '' },
        } as unknown as React.ChangeEvent<HTMLInputElement>;
        onChange(syntheticEvent);
      }
    };

    return (
      <label className="block">
        {label && <span className="mb-1.5 block text-xs font-medium text-zinc-400">{label}</span>}
        <div className="relative">
          <input
            ref={ref}
            type={type}
            value={value}
            onChange={onChange}
            disabled={disabled}
            readOnly={readOnly}
            className={`${fieldBase} ${canClear ? 'pr-8' : ''} ${className ?? ''}`}
            {...props}
          />
          {canClear && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
              title="Clear field"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </label>
    );
  }
);
TextField.displayName = 'TextField';

export const SelectField = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { label?: string }
>(({ label, className, children, ...props }, ref) => (
  <label className="block">
    {label && <span className="mb-1.5 block text-xs font-medium text-zinc-400">{label}</span>}
    <select ref={ref} className={`${fieldBase} ${className ?? ''}`} {...props}>
      {children}
    </select>
  </label>
));
SelectField.displayName = 'SelectField';

export interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  onClear?: () => void;
  showClear?: boolean;
}

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  ({ label, className, value, onChange, onClear, showClear = true, disabled, readOnly, ...props }, ref) => {
    const hasValue = value !== undefined && value !== null && String(value).length > 0;
    const canClear = showClear && hasValue && !disabled && !readOnly;

    const handleClear = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (onClear) {
        onClear();
      } else if (onChange) {
        const syntheticEvent = {
          target: { value: '' },
          currentTarget: { value: '' },
        } as unknown as React.ChangeEvent<HTMLTextAreaElement>;
        onChange(syntheticEvent);
      }
    };

    return (
      <label className="block">
        <div className="flex items-center justify-between mb-1.5">
          {label && <span className="block text-xs font-medium text-zinc-400">{label}</span>}
          {canClear && (
            <button
              type="button"
              onClick={handleClear}
              className="text-[11px] text-zinc-500 hover:text-zinc-300 flex items-center gap-0.5"
              title="Clear field"
            >
              <X size={11} /> Clear
            </button>
          )}
        </div>
        <textarea
          ref={ref}
          value={value}
          onChange={onChange}
          disabled={disabled}
          readOnly={readOnly}
          className={`${fieldBase} ${className ?? ''}`}
          {...props}
        />
      </label>
    );
  }
);
TextAreaField.displayName = 'TextAreaField';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}

export function Button({ variant = 'primary', className, children, ...props }: ButtonProps) {
  const variants = {
    primary: 'bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-emerald-900 disabled:text-emerald-300',
    secondary: 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700',
    danger: 'bg-red-600/90 text-white hover:bg-red-500 disabled:bg-red-950 disabled:text-red-400',
    ghost: 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100',
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className ?? ''}`}
      {...props}
    >
      {children}
    </button>
  );
}
