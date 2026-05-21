import { ImageResponse } from 'next/og'
import { NextResponse } from 'next/server'
import React from 'react'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

type RotaShift = {
  name: string
  type: 'work' | 'holiday'
  time: string
}

type RotaDay = {
  day: string
  date: string
  opening: string
  shifts: RotaShift[]
}

function getChatId(company: string) {
  if (company === 'dlretail') {
    return process.env.TELEGRAM_CHAT_ID_DLRETAIL || process.env.TELEGRAM_CHAT_ID
  }

  return process.env.TELEGRAM_CHAT_ID
}

function getTelegramErrorMessage(data: any) {
  if (!data) return 'Telegram send failed.'

  const description = typeof data.description === 'string' ? data.description : ''
  const errorCode = data.error_code ? `Telegram ${data.error_code}` : 'Telegram error'
  const retryAfter = data.parameters?.retry_after

  if (retryAfter) {
    return `${errorCode}: ${description || 'Too many requests.'} Try again in ${retryAfter} seconds.`
  }

  if (description) return `${errorCode}: ${description}`

  return 'Telegram send failed.'
}

function getCompanyLogo(company: string) {
  if (company === 'dlretail') {
    return 'https://hmeaanftisuhcdrzmpil.supabase.co/storage/v1/object/public/item-images/DLR%20logo%20Round.png'
  }

  return 'https://hmeaanftisuhcdrzmpil.supabase.co/storage/v1/object/public/item-images/DOHPE%20dragon%20logo%20round.png'
}

function getCompanyLogoFallback(company: string) {
  if (company === 'dlretail') {
    return 'https://hmeaanftisuhcdrzmpil.supabase.co/storage/v1/object/public/item-images/thumbs/DLR%20logo%20Round.png'
  }

  return 'https://hmeaanftisuhcdrzmpil.supabase.co/storage/v1/object/public/item-images/thumbs/DOHPE%20dragon%20logo%20round.png'
}

function getCompanyDisplayName(company: string) {
  if (company === 'dlretail') return 'DL RETAIL'
  return 'DOHPE VINTAGE'
}

function el(type: string, props: any, ...children: any[]) {
  return React.createElement(type, props, ...children)
}

async function getLogoDataUrl(company: string) {
  const urls = [getCompanyLogo(company), getCompanyLogoFallback(company)]

  for (const logoUrl of urls) {
    try {
      const response = await fetch(logoUrl, { cache: 'no-store' })
      if (!response.ok) continue

      const contentType = response.headers.get('content-type') || 'image/png'
      const arrayBuffer = await response.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)

      let binary = ''
      for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i])
      }

      return `data:${contentType};base64,${btoa(binary)}`
    } catch {
      // try next logo url
    }
  }

  return getCompanyLogoFallback(company)
}

function getEmployeeNames(days: RotaDay[], staffNames: string[]) {
  const names: string[] = []

  for (const name of staffNames) {
    if (name && !names.includes(name)) names.push(name)
  }

  for (const day of days) {
    for (const shift of day.shifts) {
      if (shift.name && !names.includes(shift.name)) names.push(shift.name)
    }
  }

  return names
}

function getShiftTextForEmployee(day: RotaDay, employeeName: string) {
  const shifts = day.shifts.filter((shift) => shift.name === employeeName)

  if (shifts.length === 0) return ''

  return shifts
    .map((shift) => {
      if (shift.type === 'holiday') return `HOLIDAY · ${shift.time}`
      if (shift.time === 'FULL DAY') return day.opening
      return shift.time
    })
    .join('\n')
}

async function makeImage(company: string, weekLabel: string, days: RotaDay[], staffNames: string[]) {
  const companyName = getCompanyDisplayName(company)
  const logoSrc = await getLogoDataUrl(company)
  const employees = getEmployeeNames(days, staffNames)

  return new ImageResponse(
    el(
      'div',
      {
        style: {
          width: 1200,
          height: 675,
          background: '#f8fafc',
          padding: 30,
          fontFamily: 'Arial',
          color: '#0f172a',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        },
      },

      el(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          },
        },

        el(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 22,
            },
          },

          el(
            'div',
            {
              style: {
                width: 98,
                height: 98,
                borderRadius: 999,
                background: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                boxShadow: '0 6px 18px rgba(15, 23, 42, 0.12)',
              },
            },
            el('img', {
              src: logoSrc,
              width: 98,
              height: 98,
              style: {
                width: 98,
                height: 98,
                borderRadius: 999,
                objectFit: 'contain',
              },
            })
          ),

          el(
            'div',
            { style: { display: 'flex', flexDirection: 'column' } },
            el(
              'div',
              {
                style: {
                  fontSize: 40,
                  fontWeight: 900,
                  letterSpacing: 1,
                },
              },
              companyName
            ),
            el(
              'div',
              {
                style: {
                  fontSize: 22,
                  fontWeight: 800,
                  color: '#0891b2',
                },
              },
              `STAFF ROTA · ${weekLabel}`
            )
          )
        ),

        el(
          'div',
          {
            style: {
              fontSize: 20,
              fontWeight: 900,
              background: '#0f172a',
              color: 'white',
              borderRadius: 999,
              padding: '10px 20px',
            },
          },
          'ROTA'
        )
      ),

      el(
        'div',
        {
          style: {
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            border: '2px solid #cbd5e1',
            borderRadius: 22,
            overflow: 'hidden',
            background: 'white',
          },
        },

        el(
          'div',
          {
            style: {
              display: 'flex',
              minHeight: 82,
              background: '#0f172a',
              color: 'white',
            },
          },
          el(
            'div',
            {
              style: {
                width: 150,
                padding: 12,
                borderRight: '2px solid #334155',
                display: 'flex',
                alignItems: 'center',
                fontSize: 20,
                fontWeight: 900,
              },
            },
            'EMPLOYEE'
          ),

          ...days.map((day) =>
            el(
              'div',
              {
                key: `${day.day}-${day.date}`,
                style: {
                  flex: 1,
                  padding: 10,
                  borderRight: '2px solid #334155',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  gap: 2,
                },
              },
              el('div', { style: { fontSize: 21, fontWeight: 900 } }, day.day),
              el(
                'div',
                {
                  style: {
                    fontSize: 15,
                    fontWeight: 800,
                    color: '#cbd5e1',
                  },
                },
                day.date
              ),
              el(
                'div',
                {
                  style: {
                    fontSize: 14,
                    fontWeight: 900,
                    color: '#67e8f9',
                  },
                },
                day.opening
              )
            )
          )
        ),

        employees.length === 0
          ? el(
              'div',
              {
                style: {
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 34,
                  fontWeight: 900,
                  color: '#94a3b8',
                },
              },
              'No staff added'
            )
          : el(
              'div',
              {
                style: {
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                },
              },
              ...employees.map((employeeName, employeeIndex) =>
                el(
                  'div',
                  {
                    key: employeeName,
                    style: {
                      flex: 1,
                      display: 'flex',
                      background: employeeIndex % 2 === 0 ? '#ffffff' : '#f8fafc',
                      borderTop: employeeIndex === 0 ? '0px solid transparent' : '2px solid #e2e8f0',
                    },
                  },
                  el(
                    'div',
                    {
                      style: {
                        width: 150,
                        padding: 12,
                        borderRight: '2px solid #e2e8f0',
                        display: 'flex',
                        alignItems: 'center',
                        fontSize: 21,
                        fontWeight: 900,
                      },
                    },
                    employeeName
                  ),

                  ...days.map((day) => {
                    const shiftText = getShiftTextForEmployee(day, employeeName)
                    const isHoliday = shiftText.includes('HOLIDAY')

                    return el(
                      'div',
                      {
                        key: `${employeeName}-${day.day}`,
                        style: {
                          flex: 1,
                          padding: 9,
                          borderRight: '2px solid #e2e8f0',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          whiteSpace: 'pre-wrap',
                          textAlign: 'center',
                          fontSize: shiftText.includes('\n') ? 15 : 17,
                          lineHeight: 1.2,
                          fontWeight: shiftText ? 900 : 700,
                          color: isHoliday ? '#b45309' : shiftText ? '#0e7490' : '#cbd5e1',
                          background: shiftText
                            ? isHoliday
                              ? '#fef3c7'
                              : '#ecfeff'
                            : 'transparent',
                        },
                      },
                      shiftText || '—'
                    )
                  })
                )
              )
            )
      )
    ),
    { width: 1200, height: 675 }
  )
}

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const company = String(body.company || 'dohpe')
    const weekLabel = String(body.weekLabel || '')
    const days: RotaDay[] = Array.isArray(body.days) ? body.days : []
    const staffNames: string[] = Array.isArray(body.staffNames)
      ? body.staffNames.map((name: any) => String(name || '')).filter(Boolean)
      : []

    const resend = Boolean(body.resend)
    const sentAt = new Date().toISOString().replace(/[:.]/g, '-')
    const companyName = getCompanyDisplayName(company)

    const botToken = process.env.TELEGRAM_BOT_TOKEN
    const chatId = getChatId(company)

    if (!botToken || !chatId) {
      return NextResponse.json(
        {
          ok: false,
          message: 'Missing Telegram bot token or chat id.',
        },
        { status: 500 }
      )
    }

    const imageResponse = await makeImage(company, weekLabel, days, staffNames)
    const imageBlob = await imageResponse.blob()

    const formData = new FormData()

    formData.append('chat_id', chatId)
    formData.append('caption', `${companyName} rota · ${weekLabel}`)
    formData.append(
      'photo',
      imageBlob,
      `${company}-${weekLabel.replaceAll(' ', '-')}${resend ? `-resend-${sentAt}` : ''}.png`
    )

    const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: 'POST',
      body: formData,
    })

    const telegramData = await telegramResponse.json().catch(() => null)

    if (!telegramResponse.ok || !telegramData?.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: getTelegramErrorMessage(telegramData),
          telegramData,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      sent: true,
      company,
      weekLabel,
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        message: error.message || 'Rota Telegram send failed.',
      },
      { status: 500 }
    )
  }
}