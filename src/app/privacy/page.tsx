import Link from 'next/link';
import type { Metadata } from 'next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BackLink } from '@/components/shell/back-link';
import { formatLongDate } from '@/lib/dates';
import { LEGAL_OPERATOR, LEGAL_VERSION_DATE, PRIVACY_CONTACT_EMAIL, PRIVACY_OFFICER_TITLE } from '@/lib/legal';

export const metadata: Metadata = { title: 'Privacy Notice' };

// Public, no-login page -- linked from the accept-invite screen (before an
// account exists), /terms/accept and /settings. Accepted together with
// /terms as one checkbox; a material change here means bumping
// LEGAL_VERSION_DATE (lib/legal.ts) so everyone re-accepts.
//
// Written against PIPEDA's ten fair information principles, with Quebec's
// Law 25 and the Alberta/BC PIPAs in mind (privacy officer, transfers
// outside the province, breach notification, complaint bodies). Rewritten in
// P33 to describe the whole app as it is -- including phone numbers, the
// calendar, to-dos, reminders, push notifications and call tracking -- and
// to stop promising a self-service account deletion P13c removed. The
// matching engineering record is 04-security.md "Privacy".

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-4">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm leading-relaxed text-fg-2">{children}</CardContent>
    </Card>
  );
}

function Who({ who, children }: { who: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line pt-2 first:border-0 first:pt-0">
      <dt className="font-semibold text-fg">{who}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

const mail = `mailto:${PRIVACY_CONTACT_EMAIL}`;

export default function PrivacyPage() {
  return (
    <main className="min-h-screen px-4 py-12 bg-bg">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Privacy notice</h1>
          <BackLink href="/settings" label="Settings" />
        </div>
        <p className="text-xs text-fg-3">Effective {formatLongDate(LEGAL_VERSION_DATE)}</p>

        <Section id="short" title="The short version">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Your SMD and upline see your <strong>numbers</strong>: counts and totals like calls made,
              appointments and premium. They never see the people you work with, their phone numbers,
              or your notes.
            </li>
            <li>
              A contact&apos;s phone number is optional. It is used only so you can call or WhatsApp
              them from the app, and only you can see it.
            </li>
            <li>
              We don&apos;t record calls, read your phone&apos;s call history or WhatsApp messages,
              track your location, show ads, or sell anything. Nothing is used to train AI.
            </li>
            <li>
              Your data is stored in Canada. A few service providers (hosting, email, push
              notifications) may process it outside Canada. See{' '}
              <a href="#providers" className="text-acc hover:underline">
                service providers
              </a>
              .
            </li>
            <li>
              You can download everything we hold about you from{' '}
              <Link href="/settings" className="text-acc hover:underline">
                Settings
              </Link>{' '}
              and contact our {PRIVACY_OFFICER_TITLE} at{' '}
              <a href={mail} className="text-acc hover:underline">
                {PRIVACY_CONTACT_EMAIL}
              </a>
              .
            </li>
          </ul>
        </Section>

        <Section id="who" title="Who we are">
          <p>
            <strong>{LEGAL_OPERATOR}</strong> (&quot;we&quot;, &quot;us&quot;) operates the Kautis app. It
            is provided to you through your organization (your SMD&apos;s team) to track your own sales
            and recruiting activity.
          </p>
          <p>
            We are accountable for the personal information in Kautis. Our {PRIVACY_OFFICER_TITLE} is
            responsible for this notice and for how we handle personal information. Contact them at{' '}
            <a href={mail} className="text-acc hover:underline">
              {PRIVACY_CONTACT_EMAIL}
            </a>
            .
          </p>
          <p>
            For information you enter about <em>other people</em> (your contacts), you and your
            organization decide what to collect and why. We store and process it on your behalf, only
            to run the app for you.
          </p>
        </Section>

        <Section id="collect" title="What we collect">
          <p className="font-semibold text-fg">About you</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Your name, email address, role, organization, who your SMD/upline is, your time zone,
              and when you accepted these terms.
            </li>
            <li>
              Your password and two-factor authentication. Your password is stored only in hashed
              form by our sign-in provider, so we can never read it.
            </li>
            <li>
              Your activity: calls, appointments, sales (including premium amounts), recruiting
              conversations, targets, to-dos, reminders, meeting notes, and the daily totals worked
              out from them.
            </li>
            <li>
              Your settings: which emails and push notifications you want, and the devices you turned
              push notifications on for (device and browser type).
            </li>
            <li>Feedback you send us, and the page you were on when you sent it.</li>
          </ul>

          <p className="pt-1 font-semibold text-fg">About the people you work with (contacts)</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Full name (required, so the app can tell two people apart), an optional phone number,
              and optional notes.
            </li>
            <li>
              What happened with them: calls you logged (channel, outcome, notes, follow-up date),
              calls you saved to finish later (who, when, phone or WhatsApp), appointments and
              sales.
            </li>
            <li>
              These come from what you type, an Excel file you import, or your phone&apos;s contact
              picker. With the picker, only the contacts you select are shared with Kautis (name and
              first phone number). We never see the rest of your address book.
            </li>
          </ul>

          <p className="pt-1 font-semibold text-fg">Technical information</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Sign-in cookies that keep you logged in, and short-term counters that stop too many
              requests at once (these are security features, not tracking).
            </li>
            <li>
              A record of important account and administrator actions (for example an invitation, a
              role change or an account removal) for security and audit.
            </li>
            <li>
              If you log something while offline, it waits on your own device until you&apos;re back
              online, then it is sent and removed from the device.
            </li>
          </ul>

          <p className="pt-1 font-semibold text-fg">What we don&apos;t collect</p>
          <p>
            We don&apos;t record or listen to calls, read your phone&apos;s call log, texts or
            WhatsApp messages, or track your location. We use no advertising or analytics cookies.
            When you tap call or WhatsApp, your phone&apos;s dialer or the WhatsApp app takes over.
            Kautis only knows which contact and which button you tapped, and what you log afterwards.
          </p>
        </Section>

        <Section id="use" title="Why we use it">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              To run the app for you: your contacts, callback queue, calendar, to-dos, reminders,
              tap-to-call, and your own dashboard.
            </li>
            <li>
              To give your SMD and upline your activity totals, and your organization its team
              reporting (counts only, see below).
            </li>
            <li>
              To send the emails and notifications you have turned on (reminders, appointment alerts,
              the morning brief, weekly digests), and essential account emails such as invitations,
              password resets and security notices.
            </li>
            <li>
              To keep the service secure, prevent misuse, fix problems and answer your feedback.
            </li>
          </ul>
          <p>
            We use personal information only for these purposes. We ask for your consent again before
            using it for anything new. Nothing is sold, rented or shared for anyone&apos;s marketing,
            and nothing is used to train AI models.
          </p>
        </Section>

        <Section id="see" title="Who can see what">
          <dl className="space-y-2">
            <Who who="You">Everything you enter, plus your own totals and dashboards.</Who>
            <Who who="Your SMD and anyone above them in your reporting line">
              Your name and email, your role and status, and your <strong>numbers</strong>: calls,
              appointments set and held, sales and premium, recruiting, streaks, when you last logged,
              and your targets. By day, week and cycle. They never see your contacts&apos; names,
              phone numbers, notes, call outcomes or follow-up dates. The database itself enforces
              this: leaders can only ask it for totals.
            </Who>
            <Who who="Anyone in another organization">Nothing. Each organization is fenced off completely.</Who>
            <Who who="Kautis administrators (our staff)">
              Account details (name, email, role, status, organization), activity totals for
              reporting, the audit record and feedback. Administrators cannot open your contacts,
              phone numbers or notes in the app. Our technical staff may access the underlying
              database only when needed to operate, secure or repair the service, and only for that
              purpose.
            </Who>
            <Who who="Service providers">Only what they need to do their job for us. See below.</Who>
          </dl>
          <p>
            We may disclose information if the law requires it (for example a valid court order), and
            only what is required.
          </p>
        </Section>

        <Section id="providers" title="Service providers and where your data is stored">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Supabase</strong>: database and sign-in. Your data is stored in Canada
              (Montréal region) and encrypted at rest.
            </li>
            <li>
              <strong>Vercel</strong>: hosts the app. It may process requests outside Canada,
              including in the United States.
            </li>
            <li>
              <strong>Resend</strong>: sends our emails, from the United States. It sees the email
              address and the content of each email.
            </li>
            <li>
              <strong>Your browser&apos;s push service</strong> (Google, Apple, Mozilla or Microsoft,
              depending on your device) delivers push notifications. Their content is encrypted so
              the push service cannot read it.
            </li>
            <li>
              <strong>Your phone&apos;s dialer and WhatsApp (Meta)</strong>: when you tap call or
              WhatsApp, the number is handed to them. Their own terms and privacy policies apply from
              that point.
            </li>
          </ul>
          <p>
            Where information is processed outside Canada, or outside your province, it is subject to
            the laws of that place and may be accessible to its authorities. Our providers are bound
            by contract to protect it and to use it only to provide their service to us.
          </p>
        </Section>

        <Section id="keep" title="How long we keep it">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Call logs</strong> are deleted automatically after 24 months (your organization
              can set a different period), unless the contact became a sale. That history is kept as
              part of the client relationship.
            </li>
            <li>
              <strong>Bell notifications</strong> are deleted after 60 days.
            </li>
            <li>
              <strong>Contacts</strong> (with their phone numbers and notes), appointments, sales,
              to-dos and reminders are kept while your account is active, until you delete them.
              Deleting a contact removes their phone number, notes, calls and appointments with it.
            </li>
            <li>
              <strong>Your account</strong> is kept until it is removed. When it is removed, your
              contacts, notes and activity are permanently deleted. Your organization keeps the daily
              totals it already had (counts only, never contacts or notes), so past team reports
              don&apos;t change.
            </li>
            <li>
              Deleted information can remain in encrypted backups for up to 30 days before it is
              overwritten.
            </li>
          </ul>
        </Section>

        <Section id="safe" title="How we protect it">
          <ul className="list-disc space-y-1 pl-5">
            <li>Everything travels over encrypted connections (HTTPS) and is encrypted at rest.</li>
            <li>Access is by invitation only, and two-factor authentication is required.</li>
            <li>
              Database security rules keep each person&apos;s records to themselves and each
              organization separate. They are checked by automated tests on every change.
            </li>
            <li>
              Limits on repeated requests, an audit record of sensitive actions, and a written
              incident response plan.
            </li>
          </ul>
        </Section>

        <Section id="rights" title="Your rights and choices">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Access:</strong> download everything we hold about you, at any time, from{' '}
              <Link href="/settings" className="text-acc hover:underline">
                Settings
              </Link>
              , or ask our {PRIVACY_OFFICER_TITLE}.
            </li>
            <li>
              <strong>Correction:</strong> edit your profile, contacts and logs in the app, or ask us
              to correct anything you can&apos;t.
            </li>
            <li>
              <strong>Withdraw consent:</strong> turn emails and push notifications off in Settings,
              remove a phone number or delete a contact at any time, or ask for your account to be
              removed. Removing your account ends your access to the app.
            </li>
            <li>
              <strong>Deletion:</strong> email{' '}
              <a href={mail} className="text-acc hover:underline">
                {PRIVACY_CONTACT_EMAIL}
              </a>{' '}
              or ask your SMD to have your account removed. It is permanent.
            </li>
            <li>
              <strong>Questions or complaints:</strong> contact our {PRIVACY_OFFICER_TITLE}. We answer
              within 30 days. If you are not satisfied, you can complain to the{' '}
              <a href="https://www.priv.gc.ca" className="text-acc hover:underline" target="_blank" rel="noopener noreferrer">
                Office of the Privacy Commissioner of Canada
              </a>
              , or, in Quebec, the{' '}
              <a href="https://www.cai.gouv.qc.ca" className="text-acc hover:underline" target="_blank" rel="noopener noreferrer">
                Commission d&apos;accès à l&apos;information
              </a>
              . In Alberta or British Columbia, you can also go to that province&apos;s Information
              and Privacy Commissioner.
            </li>
          </ul>
          <p>
            A contact you&apos;ve entered can ask you to correct or delete their information. You can
            delete a contact at any time, or ask us to help.
          </p>
        </Section>

        <Section id="others" title="Information about other people">
          <p>
            When you add a contact, you are giving us information about someone who hasn&apos;t
            signed up to Kautis. Only add people you have a real business reason to contact, and only
            what you need: a name, and a number if you plan to call them. Never put sensitive
            information in notes: no health details, Social Insurance Numbers, banking or card
            details, or passwords. Delete a contact when they ask you to, or when you no longer need
            them. The{' '}
            <Link href="/terms" className="text-acc hover:underline">
              Terms &amp; Conditions
            </Link>{' '}
            explain your responsibilities when calling or messaging them.
          </p>
        </Section>

        <Section id="breach" title="If something goes wrong">
          <p>
            If a breach of security safeguards involving your information creates a real risk of
            significant harm, we will tell you and report it to the Privacy Commissioner of Canada
            (and, where it applies, Quebec&apos;s Commission d&apos;accès à l&apos;information) as
            soon as feasible. We will explain what happened and what you can do. We keep a record of
            every breach, whatever its size.
          </p>
        </Section>

        <Section id="device" title="Cookies and your device">
          <p>
            Kautis uses only essential cookies and device storage: to keep you signed in, remember
            your in-app preferences, hold activity logged while you were offline, and deliver the
            push notifications you turned on. No advertising, analytics or third-party tracking
            cookies.
          </p>
        </Section>

        <Section id="changes" title="Changes to this notice">
          <p>
            If we change how we handle personal information, we will update this notice and its
            effective date. For a meaningful change, such as collecting something new or using it in
            a new way, we will show you what changed in the app and ask you to agree again before you
            continue. Kautis is for adults using it for their work, and is not directed at children.
          </p>
          <p>
            Contact: {LEGAL_OPERATOR}, {PRIVACY_OFFICER_TITLE},{' '}
            <a href={mail} className="text-acc hover:underline">
              {PRIVACY_CONTACT_EMAIL}
            </a>
            .
          </p>
        </Section>
      </div>
    </main>
  );
}
