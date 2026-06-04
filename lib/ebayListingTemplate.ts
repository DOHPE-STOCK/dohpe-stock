function clean(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function escapeHtml(value: any) {
  return clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function paragraphs(description: string) {
  return clean(description)
    .split(/\n{2,}|\r?\n/)
    .map((part) => clean(part))
    .filter(Boolean)
    .map((part) => `<p style="margin:0 0 8px;">${escapeHtml(part)}</p>`)
    .join('')
}

function rows(entries: Array<[string, any]>) {
  return entries
    .filter(([, value]) => clean(value))
    .map(
      ([label, value]) => `
        <tr>
          <th style="width:38%;padding:7px 10px;border-bottom:1px solid #e5e7eb;text-align:left;color:#111827;background:#f3f4f6;font-size:12px;text-transform:uppercase;letter-spacing:.03em;">${escapeHtml(label)}</th>
          <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;color:#111827;background:#ffffff;font-weight:bold;">${escapeHtml(value)}</td>
        </tr>`
    )
    .join('')
}

function section(title: string, body: string) {
  if (!clean(body)) return ''

  return `
    <section style="margin-top:14px;">
      <h2 style="margin:0 0 7px;font-size:17px;line-height:1.2;color:#111827;border-bottom:2px solid #111827;padding-bottom:5px;">${escapeHtml(title)}</h2>
      ${body}
    </section>`
}

function tableSection(title: string, entries: Array<[string, any]>) {
  const body = rows(entries)
  if (!body) return ''

  return section(
    title,
    `<div style="overflow:hidden;border:1px solid #d1d5db;border-radius:8px;background:#ffffff;">
      <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-size:14px;">${body}</table>
    </div>`
  )
}

const DOHPE_LOGO_URL =
  'https://hmeaanftisuhcdrzmpil.supabase.co/storage/v1/object/public/photo-imports/Logos/Dohpe_logo_transparent_bk__black_wider_version%20cropped.png'

export function buildEbayDescriptionHtml(params: {
  title: string
  description: string
  displayTitle?: string
  aspects?: Record<string, any>
}) {
  const aspects = params.aspects || {}
  const condition = clean(aspects.Condition)
  const flaws = clean(aspects.Flaws)
  const description = paragraphs(params.description)
  const displayTitle = clean(params.displayTitle) || params.title

  const itemSpecifics = tableSection('Item Details', [
    ['Brand', aspects.Brand],
    ['Type', aspects.Type],
    ['Department', aspects.Department],
    ['Size', aspects.Size],
    ['Size Type', aspects['Size Type']],
    ['Colour', aspects.Colour || aspects.Color],
    ['Secondary Colour', aspects['Secondary Colour']],
    ['Style', aspects.Style],
    ['Material', aspects.Material || aspects['Outer Shell Material']],
    ['Era', aspects.Era],
  ])

  const measurements = tableSection('Measurements (Inches)', [
    ['Pit to Pit', aspects['Pit to Pit']],
    ['Collar to Hem', aspects['Collar to Hem']],
    ['Pit to Cuff', aspects['Pit to Cuff']],
    ['Sleeve Length', aspects['Sleeve Length']],
    ['Waist', aspects.Waist],
    ['Inside Leg', aspects['Inside Leg']],
    ['Rise', aspects.Rise],
    ['Hem Width', aspects['Hem Width']],
  ])

  const conditionBody = [
    condition ? `<p style="margin:0 0 8px;"><strong>Condition:</strong> ${escapeHtml(condition)}</p>` : '',
    flaws ? `<p style="margin:0;"><strong>Notes:</strong> ${escapeHtml(flaws)}</p>` : '',
  ]
    .filter(Boolean)
    .join('')

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.42;color:#111827;max-width:860px;margin:0 auto;background:#ffffff;">
      <header style="padding:8px 0 12px;margin-bottom:14px;border-bottom:4px solid #111827;text-align:center;">
        <img src="${DOHPE_LOGO_URL}" alt="DOHPE" style="display:block;width:360px;max-width:82%;height:auto;margin:0 auto;" />
      </header>

      <h1 style="margin:0 0 16px;text-align:center;font-size:23px;line-height:1.15;color:#111827;">${escapeHtml(displayTitle)}</h1>

      ${section('Description', description)}
      ${itemSpecifics}
      ${measurements}
      ${section('Condition', conditionBody)}

      <section style="margin-top:14px;padding:10px;border:1px solid #d1d5db;background:#f9fafb;">
        <h2 style="margin:0 0 6px;font-size:16px;color:#111827;">Postage and Returns</h2>
        <p style="margin:0 0 6px;color:#374151;">Orders are packed carefully and dispatched from the UK. Please check the photos and measurements before purchasing.</p>
        <p style="margin:0;color:#374151;">If you have any questions, send us a message before checkout and we will be happy to help.</p>
      </section>
    </div>`
}
