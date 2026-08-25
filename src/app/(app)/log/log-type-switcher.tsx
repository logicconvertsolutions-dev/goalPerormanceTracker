'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LogForm } from './log-form';
import { AppointmentForm } from '../appointments/appointment-form';
import { SaleForm } from '../sales/sale-form';
import { RecruitingForm } from '../recruiting/recruiting-form';

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
}: {
  defaultContactName?: string;
  defaultContactId?: string;
  defaultDate?: string;
}) {
  return (
    <Tabs defaultValue="call">
      <TabsList>
        <TabsTrigger value="call">Call</TabsTrigger>
        <TabsTrigger value="appointment">Appointment</TabsTrigger>
        <TabsTrigger value="sale">Sale</TabsTrigger>
        <TabsTrigger value="recruiting">Recruiting</TabsTrigger>
      </TabsList>

      <TabsContent value="call">
        <LogForm
          defaultContactName={defaultContactName}
          defaultContactId={defaultContactId}
          defaultDate={defaultDate}
        />
      </TabsContent>
      <TabsContent value="appointment">
        <AppointmentForm
          mode="create"
          prefillContactName={defaultContactName}
          prefillContactId={defaultContactId}
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
