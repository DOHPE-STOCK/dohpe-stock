export type TenantCronCompany = {
  id: string
  name: string
  slug: string
}

export async function getEnabledIntegrationCompanies(
  supabase: any,
  channel: string,
  manual = false
): Promise<TenantCronCompany[]> {
  let settingsQuery = supabase
    .from('integration_settings')
    .select('company_id, enabled, auto_sync')
    .eq('channel', channel)
    .eq('enabled', true)
    .not('company_id', 'is', null)

  if (!manual) {
    settingsQuery = settingsQuery.eq('auto_sync', true)
  }

  const { data: settingsRows, error: settingsError } = await settingsQuery

  if (settingsError) throw new Error(settingsError.message)

  const companyIds = Array.from(
    new Set((settingsRows || []).map((row: any) => row.company_id).filter(Boolean))
  )

  if (companyIds.length === 0) return []

  const { data: companies, error: companiesError } = await supabase
    .from('companies')
    .select('id, name, slug, access_state, billing_exempt')
    .in('id', companyIds)
    .in('access_state', ['active', 'trial'])

  if (companiesError) throw new Error(companiesError.message)

  return (companies || []).map((company: any) => ({
    id: String(company.id),
    name: String(company.name || company.slug || company.id),
    slug: String(company.slug || company.id),
  }))
}
