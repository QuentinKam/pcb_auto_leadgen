import { useState } from 'react';
import { Dialog, DialogFooter, DialogButton } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { api, type LeadScoreItem } from '@/lib/api';

interface OverrideDialogProps {
  lead: LeadScoreItem | null;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const GRADE_OPTIONS: Array<'A' | 'B' | 'C'> = ['A', 'B', 'C'];

export function OverrideDialog({ lead, open, onClose, onSuccess }: OverrideDialogProps) {
  const [finalGrade, setFinalGrade] = useState<'A' | 'B' | 'C'>(lead?.finalGrade ?? 'B');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // lead 变化时重置
  if (lead && lead.finalGrade !== finalGrade && !open) {
    setFinalGrade(lead.finalGrade);
  }

  async function handleSubmit() {
    if (!lead) return;
    if (!reason.trim()) {
      setError('请填写覆盖原因');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.overrideLeadScore(lead.id, {
        finalGrade,
        overrideReason: reason.trim(),
      });
      onSuccess();
      onClose();
      setReason('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '覆盖失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="人工覆盖线索等级"
      description={`当前分数 ${lead?.score ?? 0} / 模型等级 ${lead?.grade ?? '-'} → 最终等级 ${lead?.finalGrade ?? '-'}`}
    >
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium">目标等级</label>
          <div className="flex gap-2">
            {GRADE_OPTIONS.map((g) => (
              <Button
                key={g}
                variant={finalGrade === g ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFinalGrade(g)}
              >
                {g}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium">覆盖原因 *</label>
          <textarea
            className="min-h-[80px] w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm"
            placeholder="例：客户暂停 PCB 采购，降级为 B"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <DialogButton onClick={handleSubmit} disabled={submitting}>
            {submitting ? '提交中...' : '确认覆盖'}
          </DialogButton>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
