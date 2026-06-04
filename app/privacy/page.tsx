import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Privacy Policy | StockMaster',
  description: 'Privacy policy for StockMaster inventory, POS, rota, reporting, and marketplace integration software.',
}

const lastUpdated = '4 June 2026'

const sections = [
  {
    title: '1. Who We Are',
    body: [
      'StockMaster is business software for inventory management, point of sale, staff rota, reporting, and marketplace integrations. In this policy, "StockMaster", "we", "us", and "our" means the business operating the StockMaster service for the relevant workspace.',
      'For early DOHPE/DL Retail use, the service is operated by the business owner responsible for the StockMaster workspace. Before wider SaaS launch, this page should be updated with the final trading name, registered company details, postal address, and privacy contact email.',
      'If you use StockMaster as a member of staff, customer, supplier, or marketplace account holder of a retailer using the service, that retailer may also be the data controller for records they enter into StockMaster.',
    ],
  },
  {
    title: '2. What This Policy Covers',
    body: [
      'This policy explains how personal data is collected, used, shared, stored, and protected when StockMaster is used to run retail operations, manage stock, process sales, create listings, connect marketplace accounts, generate reports, manage staff rotas, and support related workflows.',
      'It applies to account owners, staff users, retail customers where their details are entered into the system, suppliers, connected marketplace users, and other people whose information appears in business records handled by StockMaster.',
    ],
  },
  {
    title: '3. Personal Data We Process',
    bullets: [
      'Account and access data, including names, email addresses, user IDs, staff profiles, staff PIN access records, roles, permissions, authentication metadata, and security logs.',
      'Staff and rota data, including shifts, clock-in and clock-out records, rota finalisation history, holiday records, payroll period summaries, unpaid break settings, hours worked, and wage-related settings entered by the account owner.',
      'Inventory and catalogue data, including SKU records, item images, item notes, product descriptions, prices, costs, supplier references, stock movements, bin locations, staff edit attribution, marketplace listing data, and AI-generated copy.',
      'Sales, order, and fulfilment data, including POS sales, refunds, receipt details, payment method summaries, marketplace order references, shipping or picking status, transfer records, loans, returns, and stock queue history.',
      'Marketplace integration data, including OAuth tokens, refresh tokens, eBay account identifiers, listing IDs, offer IDs, business policy IDs, item specifics, publish responses, category metadata, order metadata where enabled, and integration error logs.',
      'Supplier and inbound processing data, including supplier names, invoice references, purchase quantities, cost data, parsed documents, email body or attachment data where inbound automation is enabled, and verification records.',
      'Technical and diagnostic data, including device information, browser/session information, IP-related security information where available, API logs, sync queues, webhook events, platform notifications, diagnostics, and error messages.',
    ],
  },
  {
    title: '4. How We Use Data',
    bullets: [
      'To provide and operate StockMaster features, including inventory, POS, rota, payroll/holiday reports, marketplace listing, stock transfers, bins, labels, and reporting.',
      'To authenticate users, apply staff permissions, control access, and protect business data.',
      'To process POS transactions, stock movements, transfers, returns, loans, order queues, sync retries, and offline checkout recovery.',
      'To create, validate, preview, and publish marketplace listings where an authorised user connects a marketplace account.',
      'To read marketplace business policies, category metadata, item specifics, listing status, and order data where the account owner enables those integrations.',
      'To generate operational reports, sales reports, stock reports, rota reports, payroll summaries, and holiday calculations.',
      'To generate AI-assisted titles, descriptions, and catalogue content where authorised users request or enable that feature.',
      'To detect faults, investigate errors, prevent misuse, preserve audit trails, maintain security, and improve the reliability of the service.',
      'To comply with legal, tax, accounting, employment, marketplace, platform, and regulatory obligations.',
    ],
  },
  {
    title: '5. Lawful Bases',
    body: [
      'Where UK GDPR applies, the lawful bases for processing may include contract, legitimate interests, legal obligation, and consent where a third-party platform authorisation or optional feature requires it.',
      'Contract processing includes providing the StockMaster service to the account owner and authorised users. Legitimate interests include running secure retail operations, keeping audit trails, preventing fraud or data loss, troubleshooting sync errors, and improving workflows. Legal obligation may apply to accounting, tax, employment, payroll, marketplace, and compliance records.',
    ],
  },
  {
    title: '6. Marketplace Integrations',
    body: [
      'When an authorised user connects eBay or another marketplace account, StockMaster may store tokens and account metadata needed to act on that user\'s behalf. This may include reading business policies, creating listing drafts, publishing listings, managing offer IDs, checking listing readiness, and later handling order or fulfilment data if enabled.',
      'Users can revoke marketplace access through the relevant marketplace account settings. If access is revoked or disconnected inside StockMaster, we will remove or disable the tokens needed for that connection, subject to any records that must be retained for legal, accounting, audit, or operational reasons.',
    ],
  },
  {
    title: '7. eBay Account Deletion Notifications',
    body: [
      'If eBay sends a marketplace account deletion, closure, or privacy notification, StockMaster is designed to disconnect the eBay account, remove stored eBay refresh tokens, and delete or obfuscate the minimum necessary eBay account metadata.',
      'This does not automatically delete internal sales, stock, fulfilment, accounting, reporting, or audit records that a retailer may need to keep for legal or legitimate business reasons. Where possible, retained records should be minimised, obfuscated, or separated from the deleted marketplace account identity.',
    ],
  },
  {
    title: '8. AI Features',
    body: [
      'StockMaster may send selected product information, item images, and user-entered catalogue details to an AI provider to generate product titles, product descriptions, marketplace copy, or catalogue assistance.',
      'Users should not intentionally enter sensitive personal data into product fields, staff notes, item descriptions, or AI prompts. AI output should be reviewed by a human before publication. StockMaster does not intentionally use AI features to make employment, credit, legal, or similarly significant automated decisions about individuals.',
    ],
  },
  {
    title: '9. Sharing With Service Providers',
    body: [
      'StockMaster uses trusted service providers to host, store, process, secure, and operate the service. These may include hosting providers, database and file storage providers, authentication providers, payment providers, marketplace APIs, shipping and fulfilment providers, AI providers, email/document parsing services, monitoring tools, and analytics tools where enabled.',
      'Data is shared with third parties only as needed to provide the selected feature or integration, such as publishing an eBay listing, syncing an order, processing a payment, generating a shipping workflow, storing an image, parsing an inbound supplier invoice, or diagnosing an error.',
    ],
  },
  {
    title: '10. International Transfers',
    body: [
      'Some providers may process data outside the United Kingdom. Where this happens, appropriate safeguards should be used, such as adequacy regulations, standard contractual clauses, or equivalent transfer mechanisms required by applicable data protection law.',
    ],
  },
  {
    title: '11. Retention',
    body: [
      'We keep personal data only for as long as needed for the purposes described in this policy. The exact period depends on the type of data, the account owner\'s settings, legal obligations, and operational needs.',
      'Sales, accounting, tax, stock movement, payroll, rota finalisation, marketplace transaction, and audit records may need to be retained for longer than temporary logs or connection tokens. Marketplace tokens and account metadata should be removed when the connection is no longer required, when a user disconnects the integration, or when a valid marketplace deletion notification requires removal.',
    ],
  },
  {
    title: '12. Security',
    body: [
      'StockMaster uses technical and organisational measures intended to protect data, including staff permissions, role-based access, server-side routes for sensitive operations, database security controls, encrypted provider connections where available, operational logging, and restricted handling of secrets and integration tokens.',
      'No system can be guaranteed completely secure. Account owners and users should protect login credentials, restrict staff permissions appropriately, use strong marketplace account security, and report suspicious activity promptly.',
    ],
  },
  {
    title: '13. Cookies And Local Storage',
    body: [
      'StockMaster may use cookies, browser storage, and local device storage to keep users signed in, remember staff/session state, support offline POS workflows, maintain local queues, store local SKU/price data for continuity, and improve reliability during temporary internet loss.',
      'Some local storage is necessary for shop continuity, especially where checkout needs to keep working while internet access is unavailable and sync queued transactions later.',
    ],
  },
  {
    title: '14. Your Rights',
    body: [
      'Depending on your location and the context, you may have rights to access, correct, erase, restrict, object to processing, request portability, withdraw consent, and complain to a supervisory authority. These rights are not always absolute, especially where records must be kept for legal, accounting, audit, employment, fraud prevention, or legitimate business reasons.',
      'If you are staff, a customer, or a supplier of a retailer using StockMaster, contact that retailer first. If you are the account owner or connected marketplace user, you can also revoke marketplace access through the relevant platform account settings.',
    ],
  },
  {
    title: '15. Children',
    body: [
      'StockMaster is business software and is not intended for use by children. Retailers using StockMaster should not intentionally enter children\'s personal data unless they have a lawful reason to do so.',
    ],
  },
  {
    title: '16. Complaints',
    body: [
      'If you are unhappy with how your data is handled, contact the business operating your StockMaster workspace first. If UK data protection law applies, you can also complain to the Information Commissioner\'s Office at ico.org.uk.',
    ],
  },
  {
    title: '17. Changes To This Policy',
    body: [
      'We may update this policy as StockMaster develops, integrations change, providers change, or legal requirements evolve. The latest version will be published on this page with an updated date.',
    ],
  },
]

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-white text-zinc-950">
      <section className="border-b border-zinc-200 bg-black px-6 py-8 text-white">
        <div className="mx-auto max-w-4xl">
          <Link href="/" className="text-sm font-black text-green-300 hover:text-green-200">
            Back to StockMaster
          </Link>
          <h1 className="mt-5 text-4xl font-black tracking-normal">Privacy Policy</h1>
          <p className="mt-2 text-sm font-bold text-zinc-300">Last updated: {lastUpdated}</p>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-8">
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm leading-6 text-zinc-700">
          This policy is written for StockMaster as retail operations SaaS covering inventory, POS, rota, reporting,
          AI catalogue assistance, and marketplace integrations. Account owners should make sure their own staff,
          supplier, customer, payroll, and marketplace use of StockMaster matches this policy.
        </div>

        <div className="mt-8 space-y-8">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-xl font-black">{section.title}</h2>
              <div className="mt-3 space-y-3 text-sm leading-6 text-zinc-700">
                {section.body?.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {section.bullets && (
                  <ul className="list-disc space-y-2 pl-5">
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ))}
        </div>
      </section>
    </main>
  )
}
