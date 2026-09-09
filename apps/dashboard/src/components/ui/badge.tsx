import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]',
        secondary: 'bg-[var(--color-secondary)] text-[var(--color-secondary-foreground)]',
        destructive: 'bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)]',
        outline: 'border border-[var(--color-border)] text-[var(--color-foreground)]',
        // 业务语义
        gradeA: 'bg-green-100 text-green-800',
        gradeB: 'bg-yellow-100 text-yellow-800',
        gradeC: 'bg-gray-100 text-gray-800',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { badgeVariants };
