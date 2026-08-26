'use client';

import type { CSSProperties } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ACTIVITY_META } from '@/components/shell/activity-icons';
import { LogForm } from './log-form';
import { AppointmentForm } from '../appointments/appointment-form';
import { SaleForm } from '../sales/sale-form';
import { RecruitingForm } from '../recruiting/recruiting-form';

const CallIcon = ACTIVITY_META.call.icon;
const AppointmentIcon = ACTIVITY_META.appointment.icon;
const SaleIcon = ACTIVITY_META.sale.icon;
const RecruitingIcon = ACTIVITY_META.recruiting.icon;

/** CSS var driving each trigger's active-state color (set inline per-trigger below,
 * consumed via data-[state=active] in the arbitrary-value classes on TabsTrigger). */
function activeColorStyle(color: string): CSSProperties {
  return { '--tab-active-color': color } as CSSProperties;
}

const activeColorClasses =
  'data-[state=active]:bg-[color:var(--tab-active-color)]/10 data-[state=active]:text-[color:var(--tab-active-color)] data-[state=active]:shadow-none';

/**
 * The one nav-level "Log" entry point for all four activity types. Call
 * stays the default tab so the existing five-tap call flow (and the
 * ?contact= prefill deep-link from /today and /contacts/[id]) is unchanged;
 * switching tabs reaches the same create forms used elsewhere.
 */
export function LogTypeSwitcher({
  defaultContactName,
  defaultContactId,
  defaultDate,
  onSuccess,
  onCancel,
}: {
  defaultContactName?: string;
  defaultContactId?: string;
  defaultDate?: string;
  /** When set (e.g. inside a modal), called instead of navigating away once a form saves/cancels. */
  onSuccess?: () => void;
  onCancel?: () => void;
}) {
  return (
    <Tabs defaultValue="call">
      <TabsList className="grid h-auto w-full grid-cols-4 gap-1">
        <TabsTrigger
          value="call"
          className={`flex-col gap-0.5 px-1 py-1.5 text-[11px] leading-tight sm:flex-row sm:gap-1.5 sm:px-3 sm:text-sm ${activeColorClasses}`}
          style={activeColorStyle(ACTIVITY_META.call.color)}
        >
          <CallIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">Call</span>
        </TabsTrigger>
        <TabsTrigger
          value="appointment"
          className={`flex-col gap-0.5 px-1 py-1.5 text-[11px] leading-tight sm:flex-row sm:gap-1.5 sm:px-3 sm:text-sm ${activeColorClasses}`}
          style={activeColorStyle(ACTIVITY_META.appointment.color)}
        >
          <AppointmentIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">Appointment</span>
        </TabsTrigger>
        <TabsTrigger
          value="sale"
          className={`flex-col gap-0.5 px-1 py-1.5 text-[11px] leading-tight sm:flex-row sm:gap-1.5 sm:px-3 sm:text-sm ${activeColorClasses}`}
          style={activeColorStyle(ACTIVITY_META.sale.color)}
        >
          <SaleIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">Sale</span>
        </TabsTrigger>
        <TabsTrigger
          value="recruiting"
          className={`flex-col gap-0.5 px-1 py-1.5 text-[11px] leading-tight sm:flex-row sm:gap-1.5 sm:px-3 sm:text-sm ${activeColorClasses}`}
          style={activeColorStyle(ACTIVITY_META.recruiting.color)}
        >
          <RecruitingIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">Recruiting</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="call">
        <LogForm
          defaultContactName={defaultContactName}
          defaultContactId={defaultContactId}
          defaultDate={defaultDate}
          onSuccess={onSuccess}
          onCancel={onCancel}
        />
      </TabsContent>
      <TabsContent value="appointment">
        <AppointmentForm
          mode="create"
          prefillContactName={defaultContactName}
          prefillContactId={defaultContactId}
          onSuccess={onSuccess}
          onCancel={onCancel}
        />
      </TabsContent>
      <TabsContent value="sale">
        <SaleForm mode="create" onSuccess={onSuccess} onCancel={onCancel} />
      </TabsContent>
      <TabsContent value="recruiting">
        <RecruitingForm mode="create" onSuccess={onSuccess} onCancel={onCancel} />
      </TabsContent>
    </Tabs>
  );
}
