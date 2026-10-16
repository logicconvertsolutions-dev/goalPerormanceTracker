/** What a contact import saves and who sees it -- shown before the phone
 * picker opens and before a .vcf file is imported. */
export function ImportPrivacyNotice() {
  return (
    <>
      <p>
        For each one we save the <strong>name</strong> and <strong>first phone number</strong>. They are
        visible only to you, never to your SMD or anyone else in your organization.
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
