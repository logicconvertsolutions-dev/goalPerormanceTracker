import { Skeleton } from '@/components/ui/skeleton';

export default function LogsLoading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-9 w-40" />

      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-9 w-28 rounded-lg" />
        ))}
      </div>

      <Skeleton className="h-12 w-full rounded-lg" />

      <div className="space-y-2 rounded-lg border border-line bg-panel p-4 shadow-card">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
