'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TargetForm, type TargetDefaults } from './target-form';

export function AgentOverrideRow({
  agentId,
  fullName,
  current,
  hasOverride,
  effectiveMonday,
}: {
  agentId: string;
  fullName: string;
  current: TargetDefaults;
  hasOverride: boolean;
  effectiveMonday: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t border-line py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-fg">{fullName}</span>
          {hasOverride && <Badge variant="neutral">Override</Badge>}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? 'Close' : 'Edit'}
        </Button>
      </div>
      {open && (
        <div className="mt-3 pl-1">
          <TargetForm
            agentId={agentId}
            current={current}
            effectiveMonday={effectiveMonday}
            onSaved={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
