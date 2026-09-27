import Link from 'next/link';
import type { Metadata } from 'next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BackLink } from '@/components/shell/back-link';
import { formatLongDate } from '@/lib/dates';
import { LEGAL_OPERATOR, LEGAL_VERSION_DATE, PRIVACY_CONTACT_EMAIL } from '@/lib/legal';

export const metadata: Metadata = { title: 'Terms & Conditions' };

// Public, no-login page -- linked from the accept-invite screen (before an
// account exists), the /terms/accept gate, and /settings. Keep this and
// /privacy in sync: they're accepted together as one checkbox, and a
// material change to either means bumping LEGAL_VERSION_DATE
// (lib/legal.ts) so everyone re-accepts. Rewritten in P33 for the whole app,
// including tap-to-call / WhatsApp and the calling rules that come with it.

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm leading-relaxed text-fg-2">{children}</CardContent>
    </Card>
  );
}

const external = { target: '_blank', rel: 'noopener noreferrer', className: 'text-acc hover:underline' } as const;

export default function TermsPage() {
  return (
    <main className="min-h-screen px-4 py-12 bg-bg">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Terms &amp; Conditions</h1>
          <BackLink href="/settings" label="Settings" />
        </div>
        <p className="text-xs text-fg-3">Effective {formatLongDate(LEGAL_VERSION_DATE)}</p>

        <Section title="1. About these terms">
          <p>
            These terms are an agreement between you and {LEGAL_OPERATOR} (&quot;we&quot;,
            &quot;us&quot;), the operator of Kautis. You accept them, together with the{' '}
            <Link href="/privacy" className="text-acc hover:underline">
              privacy notice
            </Link>
            , when you create your account, and again whenever we make a meaningful change. If you
            don&apos;t agree, don&apos;t use the app.
          </p>
        </Section>

        <Section title="2. Your account">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Kautis is provided to you through your organization to track your own sales and
              recruiting activity. Accounts are by invitation only and are for adults using the app
              for their work.
            </li>
            <li>
              One account per person. Keep your password and your two-factor device to yourself, and
              don&apos;t let anyone else use your account.
            </li>
            <li>
              Tell your SMD or us right away if you think someone else has accessed your account.
            </li>
          </ul>
        </Section>

        <Section title="3. Your organization">
          <p>
            Your SMD and the people above them in your reporting line see your activity totals, never
            your contacts, their phone numbers or your notes (see the{' '}
            <Link href="/privacy#see" className="text-acc hover:underline">
              privacy notice
            </Link>
            ). Your SMD or an administrator can set your targets, send you reminders, and deactivate
            your access, for example when you leave the organization.
          </p>
        </Section>

        <Section title="4. Information about other people">
          <p>By adding a contact (typed in, imported from Excel, or picked from your phone), you confirm that:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              you obtained their information lawfully and have a genuine business reason to contact
              them, in line with Canadian privacy law and your organization&apos;s policies;
            </li>
            <li>
              you add only what you need (a name, and a phone number if you plan to call), and never
              sensitive information such as health details, Social Insurance Numbers, banking or card
              details, or passwords;
            </li>
            <li>
              you keep it accurate, and delete a contact when they ask you to or when you no longer
              need them.
            </li>
          </ul>
        </Section>

        <Section title="5. Calling and messaging">
          <p>
            Tapping <strong>call</strong> opens your phone&apos;s dialer. Tapping{' '}
            <strong>WhatsApp</strong> opens a WhatsApp chat with the contact (WhatsApp does not let
            other apps start a voice call, so you tap call inside WhatsApp). The call or message
            happens on your own phone and plan: your carrier&apos;s charges and WhatsApp&apos;s own
            terms apply. Kautis does not place, record or monitor calls or messages.
          </p>
          <p>You are responsible for making sure every call and message you make follows the law, including:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              the CRTC&apos;s Unsolicited Telecommunications Rules, including the{' '}
              <a href="https://lnnte-dncl.gc.ca" {...external}>
                National Do Not Call List
              </a>
              . Check it before calling anyone you don&apos;t have an existing business relationship
              with or consent from. Keep your own do-not-call list and honour requests not to be
              called. Call only during permitted hours (currently 9:00 a.m. to 9:30 p.m. on weekdays
              and 10:00 a.m. to 6:00 p.m. on weekends, the recipient&apos;s local time);
            </li>
            <li>
              Canada&apos;s Anti-Spam Legislation (
              <a href="https://crtc.gc.ca/eng/internet/anti.htm" {...external}>
                CASL
              </a>
              ) for commercial electronic messages, including WhatsApp messages: have consent,
              identify yourself, and offer a way to unsubscribe;
            </li>
            <li>
              the rules of your insurance and securities regulators, and your organization&apos;s
              compliance policies.
            </li>
          </ul>
          <p>Kautis does not check the Do Not Call List or any consent for you.</p>
        </Section>

        <Section title="6. Acceptable use">
          <p>Don&apos;t:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>use Kautis for anything unlawful, or for anything other than your work activity;</li>
            <li>try to access another person&apos;s or organization&apos;s data, or get around security controls;</li>
            <li>copy, scrape, reverse-engineer, overload or disrupt the service, or upload malicious files;</li>
            <li>use it to harass anyone, or to send spam.</li>
          </ul>
          <p>We may suspend an account that breaks these rules or puts the service or other people at risk.</p>
        </Section>

        <Section title="7. Your data">
          <p>
            What you enter stays yours. You let us store and process it only to run Kautis for you and
            your organization, as described in the{' '}
            <Link href="/privacy" className="text-acc hover:underline">
              privacy notice
            </Link>
            . You can download it at any time from{' '}
            <Link href="/settings" className="text-acc hover:underline">
              Settings
            </Link>
            . Your organization keeps the activity totals it has already seen (counts only) after your
            account is removed.
          </p>
        </Section>

        <Section title="8. Reminders and notifications">
          <p>
            Reminders, appointment alerts and emails are a convenience. They depend on your device,
            browser, network and settings, and can arrive late or not at all. Keep your own record of
            anything time-critical. You can turn notifications off in Settings. Essential account
            emails (invitations, password resets, security notices) are always sent.
          </p>
        </Section>

        <Section title="9. The service">
          <p>
            We work to keep Kautis available and accurate, and we improve it over time, which can mean
            changing or removing features. It is provided &quot;as is&quot;: to the extent the law
            allows, we give no warranty that it will be uninterrupted or error-free. We are not liable
            for indirect or consequential losses, lost business, or decisions made from what the app
            shows. Nothing in these terms limits a right you have under a law that can&apos;t be
            waived.
          </p>
        </Section>

        <Section title="10. Ending your access">
          <p>
            Your SMD or an administrator can deactivate your account, and you can ask for it to be
            removed at any time (email{' '}
            <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="text-acc hover:underline">
              {PRIVACY_CONTACT_EMAIL}
            </a>
            ). What happens to your information afterwards is set out in the{' '}
            <Link href="/privacy#keep" className="text-acc hover:underline">
              privacy notice
            </Link>
            .
          </p>
        </Section>

        <Section title="11. Changes and governing law">
          <p>
            We may update these terms as the product changes. For a meaningful change, we will show
            you what changed in the app and ask you to agree before you continue. These terms are
            governed by the laws of the Province of Ontario and the federal laws of Canada that apply
            there.
          </p>
          <p>
            Questions:{' '}
            <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="text-acc hover:underline">
              {PRIVACY_CONTACT_EMAIL}
            </a>
            .
          </p>
        </Section>
      </div>
    </main>
  );
}
