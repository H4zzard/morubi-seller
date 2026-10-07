import { Slot } from '@radix-ui/react-slot';
import clsx from 'clsx';
import type { ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
}

export function Button({ asChild, className, variant = 'primary', ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      className={clsx('morubi-button', `morubi-button--${variant}`, className)}
      {...props}
    />
  );
}
