import { Skeleton } from '@/components/ui/skeleton';

export default function TodayLoading() {
  return (
    <div className="mx-auto max-w-lg space-y-7">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1.5">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-11 w-32 shrink-0 rounded-lg" />
      </div>

      <div className="flex gap-2.5">
        <Skeleton className="h-[84px] flex-1 rounded" />
        <Skeleton className="h-[84px] flex-1 rounded" />
        <Skeleton className="h-[84px] flex-1 rounded" />
      </div>

      <div className="space-y-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>

      <div className="space-y-3">
        <Skeleton className="h-5 w-32" />
        <div className="space-y-0 rounded-[24px] border border-line bg-panel px-4 shadow-card">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 border-b border-line py-3 last:border-0">
              <Skeleton className="h-4 w-4 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
