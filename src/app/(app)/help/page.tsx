import { requireVerifiedAgent } from '@/lib/auth/guards';
import { PageHeader } from '@/components/shell/page-header';
import { Card, CardContent } from '@/components/ui/card';

interface Topic {
  title: string;
  steps: string[];
}

const ASSOCIATE_TOPICS: Topic[] = [
  {
    title: 'My Day',
    steps: [
      'Open "My Day" (your home screen) to see who to call today — it\'s a queue of follow-ups, most overdue first.',
      'The top card is your next call. Everything below it is due today or later this week.',
      'Your call/appointment/sale counts for today sit at the top so you always know where you stand against your goal.',
    ],
  },
  {
    title: 'Logging activity',
    steps: [
      'Tap "Log Activity" from any page (rail nav, tab bar, or the button on My Day) to log a call, appointment, sale, or recruiting conversation.',
      'Pick or create the contact first — every activity is logged against a person, not a bare row, so their history builds up over time.',
      'Calls that end in "appointment set" ask for a follow-up date — that\'s what puts them back in your queue on My Day.',
      'No signal? Activity you log offline is queued and synced automatically once you\'re back online.',
    ],
  },
  {
    title: 'Contacts',
    steps: [
      'Contacts are the people you call, not the calls themselves — open one to see its full activity history in one place.',
      'Search or filter to find a contact fast when logging a new activity or checking where things left off.',
    ],
  },
  {
    title: 'My Dashboard',
    steps: [
      'See your own performance against your weekly goal — calls, appointments held, premium, and a breakdown of outcomes and lead sources.',
      'Filter by week to compare how this week is going against previous ones.',
    ],
  },
  {
    title: 'Settings',
    steps: [
      'Your goals (set by your SMD), notification preferences (evening nudge, Sunday summary, Monday digest), time zone, and workbook import all live under Settings.',
      'Importing a spreadsheet brings in existing calls, appointments, sales, and recruiting conversations from your old tracker in one pass.',
    ],
  },
];

const LEADER_TOPICS: Topic[] = [
  {
    title: 'My Team',
    steps: [
      'See your downline\'s aggregate performance per day or week — never individual prospect details, only counts and totals.',
      'Filter to one agent to see their trend without leaving the team view.',
      'Set org-wide or per-agent weekly targets — a new target only affects weeks from today forward, past weeks keep the target that was live then.',
      'Invite a new agent, move someone to a different upline, or send a one-off nudge or training reminder to someone who\'s gone quiet.',
      'Your org\'s audit trail (target changes, invitations, deactivations, nudges) lives under Team → Audit.',
    ],
  },
];

const ADMIN_TOPICS: Topic[] = [
  {
    title: 'Organizations',
    steps: [
      'Create a new organization from Orgs — this also sends the SMD their invitation email to set up the org.',
      'Deleting an organization is permanent: it erases every agent in it and everything they logged. Use it only when an org is truly done, and only after double-checking — the confirmation requires typing the org\'s name back.',
    ],
  },
  {
    title: 'Agents',
    steps: [
      'Change an agent\'s role, move them to a different upline, or reactivate a deactivated agent from Agents.',
      'Hard-delete permanently erases an agent and everything tied to them (contacts, activity history, daily counts). It cannot be undone — deactivating is the reversible alternative.',
      'Open an agent to see their full record or change their email address.',
    ],
  },
  {
    title: 'Audit',
    steps: [
      'A cross-org view of every audit event — target changes, invitations, deactivations, hard-deletes, nudges — across every organization, not just one.',
    ],
  },
  {
    title: 'Pilot',
    steps: [
      'Rollout/adoption instrumentation across organizations — who\'s logging activity and who\'s gone quiet, at a glance.',
    ],
  },
  {
    title: 'Feedback',
    steps: [
      'Bug reports and feature requests submitted from the account menu\'s "Send feedback" land here — mark them reviewed or resolved as you work through them.',
    ],
  },
  {
    title: 'Announcements',
    steps: [
      'Publish a message every signed-in user sees at the top of the app — an upcoming update, a new feature, planned downtime.',
      'Each person can dismiss it on their own; retracting it here removes it for everyone who hasn\'t dismissed it yet.',
    ],
  },
];

function TopicSection({ topic }: { topic: Topic }) {
  return (
    <details className="group border-b border-line py-3 last:border-0" open={false}>
      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-fg">
        {topic.title}
        <span className="text-fg-4 transition-transform group-open:rotate-45" aria-hidden="true">
          +
        </span>
      </summary>
      <ol className="mt-2 space-y-1.5 text-sm text-fg-2">
        {topic.steps.map((step, i) => (
          <li key={i} className="flex gap-2">
            <span className="shrink-0 text-fg-4">{i + 1}.</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

export default async function HelpPage() {
  const session = await requireVerifiedAgent();
  const role = session.agent!.role;

  const topics =
    role === 'admin' ? ADMIN_TOPICS : role === 'leader' ? [...ASSOCIATE_TOPICS, ...LEADER_TOPICS] : ASSOCIATE_TOPICS;

  return (
    <div className="space-y-4 max-w-2xl">
      <PageHeader
        title="How to"
        subtitle="Guided steps for what you can do here. Tap a topic to expand it."
      />
      <Card>
        <CardContent className="pt-4">
          {topics.map((topic) => (
            <TopicSection key={topic.title} topic={topic} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
