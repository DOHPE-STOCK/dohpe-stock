import type { Metadata } from 'next'
import './globals.css'
import { StaffProvider } from '@/app/context/StaffContext'
import ThemeProvider from '@/app/components/ThemeProvider'

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
    <html lang="en" data-theme="dark">
      <body>
        <ThemeProvider>
          <StaffProvider>{children}</StaffProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}

