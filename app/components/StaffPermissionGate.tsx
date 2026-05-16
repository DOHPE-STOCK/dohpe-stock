'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useStaff } from '@/app/context/StaffContext'

type StaffPermissionGateProps = {
  permission?: string
  permissions?: string[]
  requireAll?: boolean
  children: React.ReactNode
}

export default function StaffPermissionGate({
  permission,
  permissions,
  requireAll = false,
  children,
}: StaffPermissionGateProps) {
  const pathname = usePathname()
  const { staff, can } = useStaff()

  const permissionList = permissions || (permission ? [permission] : [])

  const hasPermission =
    staff &&
    staff.is_active !== false &&
    (staff.role === 'admin' ||
      permissionList.length === 0 ||
      (requireAll
        ? permissionList.every((key) => can(key))
        : permissionList.some((key) => can(key))))

  if (!staff) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-5 text-white">
        <div className="max-w-md rounded-2xl border border-yellow-800 bg-yellow-950/40 p-6 text-center">
          <h1 className="text-2xl font-black text-yellow-200">Staff PIN required</h1>

          <p className="mt-3 text-sm font-bold text-yellow-100">
            Select an active staff member before using this page.
          </p>

          <Link
            href={`/staff?next=${encodeURIComponent(pathname || '/')}`}
            className="mt-5 inline-block rounded-xl bg-yellow-300 px-5 py-3 text-sm font-black text-black"
          >
            Enter staff PIN
          </Link>
        </div>
      </main>
    )
  }

  if (!hasPermission) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-5 text-white">
        <div className="max-w-md rounded-2xl border border-red-800 bg-red-950/40 p-6 text-center">
          <h1 className="text-2xl font-black text-red-200">Access denied</h1>

          <p className="mt-3 text-sm font-bold text-red-100">
            {staff.name} does not have permission to use this page.
          </p>

          {permissionList.length > 0 && (
            <p className="mt-2 text-xs font-bold text-red-300">
              Required: {permissionList.join(requireAll ? ' + ' : ' or ')}
            </p>
          )}

          <Link
            href={`/staff?next=${encodeURIComponent(pathname || '/')}`}
            className="mt-5 inline-block rounded-xl bg-white px-5 py-3 text-sm font-black text-black"
          >
            Switch staff
          </Link>
        </div>
      </main>
    )
  }

  return <>{children}</>
}