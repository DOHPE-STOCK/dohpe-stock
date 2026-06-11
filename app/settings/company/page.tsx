import { redirect } from 'next/navigation'

export default function CompanySettingsRedirect() {
  redirect('/settings?section=company')
}

