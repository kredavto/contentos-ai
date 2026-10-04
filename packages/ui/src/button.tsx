import type { ComponentProps } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './utils';
// shadcn/ui composition pattern (Radix Slot + CVA), styled for this product.
const buttonVariants = cva('button disabled:pointer-events-none', {
  variants: { variant: { default: 'primary', secondary: 'secondary', light: 'light' } },
  defaultVariants: { variant: 'default' },
});
export function Button({ className, variant, asChild = false, ...props }: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : 'button';
  return <Component data-slot="button" className={cn(buttonVariants({ variant, className }))} {...props} />;
}
