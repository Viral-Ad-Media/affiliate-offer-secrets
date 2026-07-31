export const metadata = {
  title: "Privacy Policy — Affiliate Studio",
  description: "Privacy Policy for Affiliate Studio.",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:py-20">
      <h1 className="text-3xl font-bold text-zinc-100 sm:text-4xl">Privacy Policy</h1>
      <p className="mt-3 text-sm text-zinc-500">Last updated: [DATE]</p>

      <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
        This is placeholder legal content, not a finished legal document. Have a qualified lawyer
        review and finalize this Privacy Policy — including the bracketed items below — before
        relying on it or publishing this page live.
      </div>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-zinc-400">
        <section>
          <h2 className="font-heading text-lg font-semibold text-zinc-100">1. What we collect</h2>
          <p className="mt-2">
            When you create an account we collect your email address and any profile details you
            provide (such as your affiliate nickname). If you connect Facebook, we store your
            Meta user ID and the OAuth access tokens needed to post and launch campaigns on your
            behalf — access tokens are stored encrypted and are never shown back to you in
            plaintext. We also record usage data such as jobs run, content generated, and posts
            or ad campaigns published, for billing and support purposes.
          </p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-semibold text-zinc-100">2. How we use it</h2>
          <p className="mt-2">
            We use your data to operate the Service: authenticate you, generate campaign content,
            publish to your connected Facebook Page when you request it, launch ad campaigns you
            explicitly activate, process payments, and provide support. We do not sell your
            personal data.
          </p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-semibold text-zinc-100">3. Third-party services</h2>
          <p className="mt-2">
            We share the minimum data necessary with the following processors: Stripe (payment
            processing), Meta/Facebook (when you connect an account, to publish posts and manage
            ad campaigns on your behalf), Supabase (database and authentication hosting), and
            Anthropic (to generate marketing content — product and sales-page text is sent to
            generate your campaign kits). [Add or remove processors to match your actual
            infrastructure before publishing.]
          </p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-semibold text-zinc-100">4. Data retention</h2>
          <p className="mt-2">
            We retain account and campaign data for as long as your account is active. If you
            disconnect Facebook, stored access tokens for that connection are deleted. You may
            request deletion of your account and associated data at any time by contacting us.
          </p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-semibold text-zinc-100">5. Security</h2>
          <p className="mt-2">
            Access tokens and other sensitive credentials are stored using encrypted secret
            storage, not plaintext database columns, and are only ever retrieved by trusted
            server-side code to perform the action you requested (e.g. publishing a post).
          </p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-semibold text-zinc-100">6. Your rights</h2>
          <p className="mt-2">
            Depending on your location, you may have rights to access, correct, or delete your
            personal data. To exercise these rights, contact us at [SUPPORT EMAIL]. [Expand this
            section for GDPR/CCPA or other applicable regional requirements as needed.]
          </p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-semibold text-zinc-100">7. Changes to this policy</h2>
          <p className="mt-2">
            We may update this Privacy Policy from time to time. Material changes will be
            reflected by updating the "Last updated" date above.
          </p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-semibold text-zinc-100">8. Contact</h2>
          <p className="mt-2">
            Questions about this Privacy Policy can be sent to [SUPPORT EMAIL].
          </p>
        </section>
      </div>
    </div>
  );
}
