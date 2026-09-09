import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LeadsPage } from '@/pages/LeadsPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30s 内不重复请求
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LeadsPage />
    </QueryClientProvider>
  );
}
