import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
}

export function Dialog({ open, onClose, title, description, children }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className={cn(
          'relative z-50 w-full max-w-lg rounded-lg border border-[var(--color-border)]',
          'bg-[var(--color-card)] p-6 shadow-lg'
        )}
      >
        {title && <h2 className="mb-2 text-lg font-semibold">{title}</h2>}
        {description && (
          <p className="mb-4 text-sm text-[var(--color-muted-foreground)]">{description}</p>
        )}
        {children}
      </div>
    </div>
  );
}

interface DialogFooterProps {
  children: ReactNode;
  className?: string;
}

export function DialogFooter({ children, className }: DialogFooterProps) {
  return <div className={cn('mt-6 flex justify-end space-x-2', className)}>{children}</div>;
}

export { Button as DialogButton };
