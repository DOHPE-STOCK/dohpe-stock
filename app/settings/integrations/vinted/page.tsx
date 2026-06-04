'use client'

import Link from 'next/link'
import AppNav from '@/app/components/AppNav'

export default function IntegrationConfigPage() {
  return (
    <main className="min-h-screen bg-neutral-950 p-5 text-white">
      <div className="app-header mb-5 flex flex-wrap items-start justify-between gap-4 rounded-3xl bg-black p-4 text-white shadow-2xl sm:p-5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-4">
          <div>
            <h1 className="text-2xl font-black tracking-normal">Vinted Configuration</h1>

            <p className="text-sm text-neutral-300">
              Placeholder settings page. We will build this integration properly later.
            </p>
          </div>

          <AppNav current="settings" />
        </div>

        <Link
          href="/settings/integrations"
          className="rounded-lg border border-neutral-700 px-4 py-2 text-sm font-semibold hover:bg-neutral-800"
        >
          Back to Integrations
        </Link>
      </div>

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-2 text-lg font-semibold">Not configured yet</h2>

        <p className="text-sm text-neutral-400">
          This page route exists so the Configure button works while we build each integration one at a time.
        </p>
      </section>
    </main>
  )
}

