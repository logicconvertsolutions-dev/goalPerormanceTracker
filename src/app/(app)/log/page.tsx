import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDisplayDate } from '@/lib/dates';
import { LogTypeSwitcher } from './log-type-switcher';

export default async function LogPage({
  searchParams,
}: {
  searchParams: { contact?: string; date?: string };
}) {
  const session = await requireAgent();
  const supabase = await createClient();

  let prefill: { id: string; full_name: string; company: string | null } | null = null;
  let history: { call_date: string; outcome: string; notes: string | null }[] = [];

  if (searchParams.contact) {
    const { data: contact } = await supabase
      .from('contacts')
      .select('id, full_name, company')
      .eq('id', searchParams.contact)
      .eq('agent_id', session.agent!.id)
      .maybeSingle();

    if (contact) {
      prefill = contact;
      const { data: pastCalls } = await supabase
        .from('call_logs')
        .select('call_date, outcome, notes')
        .eq('contact_id', contact.id)
        .order('call_date', { ascending: false })
        .limit(3);
      history = pastCalls ?? [];
    }
  }

  return (
    <div className="space-y-4 max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle>{prefill ? `Log a call — ${prefill.full_name}` : 'Quick log'}</CardTitle>
        </CardHeader>
        <CardContent>
          <LogTypeSwitcher
            defaultContactName={prefill?.full_name ?? ''}
            defaultCompany={prefill?.company ?? ''}
            defaultDate={searchParams.date === 'today' ? undefined : searchParams.date}
          />
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Recent history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {history.map((h, i) => (
              <div key={i} className="text-sm border-b border-line pb-2 last:border-0 last:pb-0">
                <p className="text-fg-2">
                  {formatDisplayDate(h.call_date)} · {h.outcome.replace('_', ' ')}
                </p>
                {h.notes && <p className="text-fg-3 text-xs mt-0.5">{h.notes}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
