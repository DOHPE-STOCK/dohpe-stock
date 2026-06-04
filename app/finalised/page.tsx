'use client'

import AppNav from '@/app/components/AppNav'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'
import FinalisedPanel from '@/app/processing/components/FinalisedPanel'

export default function FinalisedPage() {
  return (
    <StaffPermissionGate permission="finalised">
      <main className="min-h-screen bg-zinc-950 p-5 text-white">
        <div className="app-header mb-5 flex flex-wrap items-start justify-between gap-4 rounded-3xl bg-black p-4 text-white shadow-2xl sm:p-5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-4">
            <div>
              <h1 className="text-2xl font-black tracking-normal">Finalised Items</h1>
              <p className="text-sm text-zinc-300">Approved stock ready for export and listing work.</p>
            </div>

            <AppNav current="finalised" />
          </div>
        </div>

        <FinalisedPanel />
      </main>
    </StaffPermissionGate>
  )
}
