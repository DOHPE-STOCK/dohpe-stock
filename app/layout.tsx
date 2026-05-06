import type { Metadata } from 'next'
import './globals.css'
import { StaffProvider } from '@/app/context/StaffContext'

export const metadata: Metadata = {
  title: 'Dohpe Stock',
  description: 'Dohpe stock management app',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>
        <StaffProvider>{children}</StaffProvider>
      </body>
    </html>
  )
}