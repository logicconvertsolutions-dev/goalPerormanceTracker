'use client';

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

/**
 * The one nav-level "Log" entry point for all four activity types. Call
 * stays the default tab so the existing five-tap call flow (and the
 * ?contact= prefill deep-link from /today and /contacts/[id]) is unchanged;
 * switching tabs reaches the same create forms used elsewhere.
 */
export function LogTypeSwitcher({
  defaultContactName,
  defaultCompany,
  defaultDate,
}: {
  defaultContactName?: string;
  defaultCompany?: string;
  defaultDate?: string;
}) {
  return (
    <Tabs defaultValue="call">
      <TabsList>
        <TabsTrigger value="call" className="gap-1.5">
          <CallIcon className="h-4 w-4" aria-hidden="true" />
          Call
        </TabsTrigger>
        <TabsTrigger value="appointment" className="gap-1.5">
          <AppointmentIcon className="h-4 w-4" aria-hidden="true" />
          Appointment
        </TabsTrigger>
        <TabsTrigger value="sale" className="gap-1.5">
          <SaleIcon className="h-4 w-4" aria-hidden="true" />
          Sale
        </TabsTrigger>
        <TabsTrigger value="recruiting" className="gap-1.5">
          <RecruitingIcon className="h-4 w-4" aria-hidden="true" />
          Recruiting
        </TabsTrigger>
      </TabsList>

      <TabsContent value="call">
        <LogForm
          defaultContactName={defaultContactName}
          defaultCompany={defaultCompany}
          defaultDate={defaultDate}
        />
      </TabsContent>
      <TabsContent value="appointment">
        <AppointmentForm
          mode="create"
          prefillContactName={defaultContactName}
          prefillCompany={defaultCompany}
        />
      </TabsContent>
      <TabsContent value="sale">
        <SaleForm mode="create" />
      </TabsContent>
      <TabsContent value="recruiting">
        <RecruitingForm mode="create" />
      </TabsContent>
    </Tabs>
  );
}
