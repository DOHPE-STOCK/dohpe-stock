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
    return process.env.TELEGRAM_CHAT_ID_DL_RETAIL || process.env.TELEGRAM_CHAT_ID
  }

  return process.env.TELEGRAM_CHAT_ID
}

function el(type: string, props: any, ...children: any[]) {
  return React.createElement(type, props, ...children)
}

async function makeImage(companyName: string, weekLabel: string, days: RotaDay[]) {
  return new ImageResponse(
    el(
      'div',
      {
        style: {
          width: 1200,
          height: 675,
          background: '#f8fafc',
          padding: 34,
          fontFamily: 'Arial',
          color: '#0f172a',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        },
      },
      el(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
          },
        },
        el(
          'div',
          { style: { display: 'flex', flexDirection: 'column' } },
          el('div', { style: { fontSize: 44, fontWeight: 900 } }, companyName),
          el(
            'div',
            { style: { fontSize: 24, fontWeight: 800, color: '#0891b2' } },
            `Staff Rota · ${weekLabel}`
          )
        ),
        el(
          'div',
          {
            style: {
              fontSize: 22,
              fontWeight: 900,
              background: '#0f172a',
              color: 'white',
              borderRadius: 999,
              padding: '12px 22px',
            },
          },
          'ROTA'
        )
      ),

      el(
        'div',
        {
          style: {
            display: 'flex',
            gap: 10,
            flex: 1,
          },
        },
        ...days.map((day) =>
          el(
            'div',
            {
              key: `${day.day}-${day.date}`,
              style: {
                flex: 1,
                background: 'white',
                border: '2px solid #e2e8f0',
                borderRadius: 22,
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 9,
              },
            },
            el(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
              el('div', { style: { fontSize: 28, fontWeight: 900 } }, day.day),
              el('div', { style: { fontSize: 18, fontWeight: 800, color: '#64748b' } }, day.date),
              el('div', { style: { fontSize: 19, fontWeight: 900, color: '#0891b2' } }, day.opening)
            ),

            el(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 7 } },
              day.shifts.length === 0
                ? el(
                    'div',
                    {
                      style: {
                        borderRadius: 14,
                        background: '#f1f5f9',
                        padding: 12,
                        fontSize: 18,
                        fontWeight: 800,
                        color: '#94a3b8',
                      },
                    },
                    'No shifts'
                  )
                : day.shifts.map((shift, index) =>
                    el(
                      'div',
                      {
                        key: `${shift.name}-${index}`,
                        style: {
                          borderRadius: 14,
                          background: shift.type === 'holiday' ? '#fef3c7' : '#ecfeff',
                          padding: 10,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 2,
                        },
                      },
                      el('div', { style: { fontSize: 21, fontWeight: 900 } }, shift.name),
                      el(
                        'div',
                        {
                          style: {
                            fontSize: 17,
                            fontWeight: 900,
                            color: shift.type === 'holiday' ? '#b45309' : '#0e7490',
                          },
                        },
                        shift.type === 'holiday' ? `HOLIDAY · ${shift.time}` : shift.time
                      )
                    )
                  )
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
    const companyName = String(body.companyName || 'Rota')
    const weekLabel = String(body.weekLabel || '')
    const days: RotaDay[] = Array.isArray(body.days) ? body.days : []

    const botToken = process.env.TELEGRAM_BOT_TOKEN
    const chatId = getChatId(company)

    if (!botToken || !chatId) {
      return NextResponse.json(
        { ok: false, message: 'Missing Telegram bot token or chat id.' },
        { status: 500 }
      )
    }

    const imageResponse = await makeImage(companyName, weekLabel, days)
    const imageBlob = await imageResponse.blob()

    const formData = new FormData()
    formData.append('chat_id', chatId)
    formData.append('caption', `${companyName} rota · ${weekLabel}`)
    formData.append('photo', imageBlob, `${company}-${weekLabel.replaceAll(' ', '-')}.png`)

    const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: 'POST',
      body: formData,
    })

    const telegramData = await telegramResponse.json().catch(() => null)

    if (!telegramResponse.ok || !telegramData?.ok) {
      return NextResponse.json(
        { ok: false, message: 'Telegram send failed.', telegramData },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true, sent: true, company, weekLabel })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error.message || 'Rota Telegram send failed.' },
      { status: 500 }
    )
  }
}