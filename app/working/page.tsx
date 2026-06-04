'use client'

import AppNav from '@/app/components/AppNav'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'
import WorkingPanel from '@/app/processing/components/WorkingPanel'

export default function WorkingPage() {
  return (
    <StaffPermissionGate permission="working">
      <main className="min-h-screen bg-zinc-950 p-5 text-white">
        <div className="app-header mb-5 flex flex-wrap items-start justify-between gap-4 rounded-3xl bg-black p-4 text-white shadow-2xl sm:p-5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-4">
            <div>
              <h1 className="text-2xl font-black tracking-normal">Working Items</h1>
              <p className="text-sm text-zinc-300">Catalogue and prepare items before review.</p>
            </div>

            <AppNav current="working" />
          </div>
        </div>

        <WorkingPanel />
      </main>
    </StaffPermissionGate>
  )
}
