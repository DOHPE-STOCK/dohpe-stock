import type { Metadata } from 'next'
import './globals.css'
import { StaffProvider } from '@/app/context/StaffContext'
import { CompanyProvider } from '@/app/context/CompanyContext'
import ThemeProvider from '@/app/components/ThemeProvider'
import AppSessionProvider from '@/app/components/AppSessionProvider'

export const metadata: Metadata = {
  title: 'Loopbase',
  description: 'Loopbase retail operations platform',
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
          <CompanyProvider>
            <AppSessionProvider>
              <StaffProvider>{children}</StaffProvider>
            </AppSessionProvider>
          </CompanyProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}

