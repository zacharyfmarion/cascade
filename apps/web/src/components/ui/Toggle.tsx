import * as Switch from '@radix-ui/react-switch';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export interface ToggleProps extends Omit<
  ComponentPropsWithoutRef<typeof Switch.Root>,
  'checked' | 'onCheckedChange' | 'onChange'
> {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export const Toggle = forwardRef<HTMLButtonElement, ToggleProps>(
  ({ checked, onChange, className = '', ...props }, ref) => (
    <Switch.Root
      ref={ref}
      checked={checked}
      onCheckedChange={onChange}
      className={['ui-toggle', className].filter(Boolean).join(' ')}
      {...props}
    >
      <Switch.Thumb className="ui-toggle__thumb" />
    </Switch.Root>
  )
);

Toggle.displayName = 'Toggle';
