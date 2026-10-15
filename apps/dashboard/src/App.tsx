import { CampaignsPage } from '@/pages/CampaignsPage';
import { ContentReviewPage } from '@/pages/ContentReviewPage';
import { EmailSendsPage } from '@/pages/EmailSendsPage';
import { LeadsPage } from '@/pages/LeadsPage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

type TabKey = 'leads' | 'content' | 'campaigns' | 'sends';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'leads', label: '线索看板' },
  { key: 'content', label: '内容审核' },
  { key: 'campaigns', label: '发送看板' },
  { key: 'sends', label: '发送记录' },
];

function TabBar({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  return (
    <div className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-background)]">
      <div className="mx-auto flex max-w-[1600px] items-center gap-2 px-6 py-3">
        <span className="mr-4 text-lg font-bold tracking-tight">PCB 获客 Agent</span>
        <nav className="flex items-center gap-1">
          {TABS.map((t) => {
            const isActive = active === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => onChange(t.key)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                    : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<TabKey>('leads');
  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)]">
        <TabBar active={tab} onChange={setTab} />
        {tab === 'leads' && <LeadsPage />}
        {tab === 'content' && <ContentReviewPage />}
        {tab === 'campaigns' && <CampaignsPage />}
        {tab === 'sends' && <EmailSendsPage />}
      </div>
    </QueryClientProvider>
  );
}
