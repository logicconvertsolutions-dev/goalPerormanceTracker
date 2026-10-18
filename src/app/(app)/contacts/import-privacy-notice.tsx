/** What a contact import saves and who sees it -- shown before the phone
 * picker opens and before a .vcf file is imported. */
export function ImportPrivacyNotice({ withNotes = false }: { withNotes?: boolean }) {
  return (
    <>
      <p>
        For each one we save the <strong>name</strong>, <strong>one phone number</strong>
        {withNotes ? (
          <>
            {' '}
            and the contact&apos;s <strong>notes</strong> from your phone
          </>
        ) : null}
        . {withNotes ? 'They are' : 'Both are'} visible only to you, never to your SMD or anyone else in your
        organization. Nothing else (email, address, other numbers) is imported.
      </p>
      <p>
        Only import people you have a reason to contact for your business. See the{' '}
        <a href="/privacy" className="text-acc hover:underline">
          privacy notice
        </a>
        .
      </p>
    </>
  );
}
