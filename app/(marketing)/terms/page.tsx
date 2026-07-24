export const metadata = {
  title: "Terms of Service — ClickBank Studio",
  description: "Terms of Service for ClickBank Studio.",
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:py-20">
      <h1 className="text-3xl font-bold text-zinc-100 sm:text-4xl">Terms of Service</h1>
      <p className="mt-3 text-sm text-zinc-500">Last updated: [DATE]</p>

      <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
        This is placeholder legal content, not a finished legal document. Have a qualified lawyer
        review and finalize these Terms — including the bracketed items below — before relying on
        them or publishing this page live.
      </div>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-zinc-400">
        <section>
          <h2 className="font-heading text-lg font-semibold text-zinc-100">1. Acceptance of terms</h2>
          <p className="mt-2">
            By creating an account or using ClickBank Studio ("the Service"), operated by
            [LEGAL ENTITY NAME] ("we", "us"), you agree to these Terms of Service. If you do not
            agree, do not use the Service.
          </p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-semibold text-zinc-100">2. Description of the Service</h2>
          <p className="mt-2">
            ClickBank Studio provides ClickBank marketplace research and AI-generated marketing
            content (ad copy, landing pages, blog content, email content) for use by affiliate
            marketers. Optional features allow you to connect your own Facebook account to
            publish posts and launch advertising campaigns using your own connected ad account.
          </p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-semibold text-zinc-100">3. Your accounts and connections</h2>
          <p className="mt-2">
            You are solely responsible for your ClickBank account, your Facebook/Meta account,
            and any ad account you connect to the Service, including all activity and any charges
            incurred on those accounts. The Service never holds or transmits your advertising
            budget — advertising spend is billed directly by Meta to your connected payment
            method.
          </p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-semibold text-zinc-100">4. Fees and payment</h2>
          <p className="mt-2">
            Software access requires a one-time fee as shown on the Pricing page at the time of
            purchase. Ad-launch credits are purchased separately and are non-refundable once
            spent activating a campaign, except as required by applicable law. [Add your
            refund/cancellation policy specifics here.]
          </p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-semibold text-zinc-100">5. Content and compliance</h2>
          <p className="mt-2">
            AI-generated content is provided as a starting point only. You are responsible for
            reviewing all generated ad copy, landing pages, and other content for accuracy and
            for compliance with ClickBank's terms, Meta's advertising policies, and all applicable
            laws before publishing or running paid traffic to it.
          </p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-semibold text-zinc-100">6. Prohibited use</h2>
          <p className="mt-2">
            You may not use the Service to generate or publish content that is fraudulent,
            infringing, or that violates ClickBank's, Meta's, or any other third party's terms of
            service. We may suspend or terminate accounts that violate this section.
          </p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-semibold text-zinc-100">7. Disclaimers and limitation of liability</h2>
          <p className="mt-2">
            The Service is provided "as is" without warranties of any kind. We are not liable for
            any advertising spend, lost profits, account suspensions by third-party platforms, or
            other indirect or consequential damages arising from your use of the Service, to the
            maximum extent permitted by law. [Have counsel finalize this section for your
            jurisdiction.]
          </p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-semibold text-zinc-100">8. Changes to these terms</h2>
          <p className="mt-2">
            We may update these Terms from time to time. Continued use of the Service after
            changes take effect constitutes acceptance of the updated Terms.
          </p>
        </section>

        <section>
          <h2 className="font-heading text-lg font-semibold text-zinc-100">9. Contact</h2>
          <p className="mt-2">
            Questions about these Terms can be sent to [SUPPORT EMAIL].
          </p>
        </section>
      </div>
    </div>
  );
}
