import { redirect } from 'next/navigation'

export default function CompanyBillingRedirect() {
  redirect('/settings?section=billing')
}
