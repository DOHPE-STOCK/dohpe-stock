import Link from 'next/link'

type NavKey =
  | 'settings'
  | 'sku'
  | 'checkout'
  | 'working'
  | 'review'
  | 'finalised'
  | 'photo-imports'
  | 'transfers'
  | 'allocate'
  | 'loan'

type AppNavProps = {
  current?: NavKey
  onNavigate?: (url: string) => void
}

type NavItem = {
  key: NavKey
  label: string
  href: string
  iconOnly?: boolean
}

const navItems: NavItem[] = [
  { key: 'sku', label: 'SKU Search', href: '/' },
  { key: 'checkout', label: 'Checkout', href: '/checkout' },
  { key: 'working', label: 'Working', href: '/working' },
  { key: 'review', label: 'Review', href: '/review' },
  { key: 'finalised', label: 'Finalised', href: '/finalised' },
  { key: 'photo-imports', label: 'Photo Imports', href: '/photo-imports' },
  { key: 'transfers', label: 'Transfers', href: '/transfers' },
  { key: 'allocate', label: 'Allocate', href: '/scanner/allocate' },
  { key: 'loan', label: 'Loan', href: '/scanner/loan' },
  { key: 'settings', label: '⚙', href: '/settings', iconOnly: true },
]

export default function AppNav({ current, onNavigate }: AppNavProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {navItems.map((item) => {
        const isCurrent = current === item.key

        const normalClass =
          'rounded-lg px-4 py-2 text-xs font-bold bg-zinc-800 hover:bg-zinc-700'

        const iconClass = 'px-2 text-lg text-zinc-400 hover:text-white'

        if (isCurrent) {
          return (
            <button
              key={item.key}
              type="button"
              disabled
              className={
                item.iconOnly
                  ? `${iconClass} text-white`
                  : `${normalClass} bg-zinc-700 text-white ring-1 ring-zinc-500`
              }
            >
              {item.label}
            </button>
          )
        }

        if (onNavigate) {
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onNavigate(item.href)}
              className={item.iconOnly ? iconClass : normalClass}
            >
              {item.label}
            </button>
          )
        }

        return (
          <Link
            key={item.key}
            href={item.href}
            className={item.iconOnly ? iconClass : normalClass}
          >
            {item.label}
          </Link>
        )
      })}
    </div>
  )
}