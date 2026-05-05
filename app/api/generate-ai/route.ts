import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { item, imageUrls } = body

    if (!item) {
      return Response.json({ error: 'Missing item data' }, { status: 400 })
    }

    const fieldsUsed = {
      brand: item.brand,
      reporting_category: item.reporting_category,
      gender: item.gender,
      tagged_size: item.tagged_size,
      colour_primary: item.colour_primary,
      material: item.material,
      era: item.era,
      style: item.style,
      basic_title: item.basic_title,
      basic_description: item.basic_description,
    }

    const measurements = {
      'Pit to Pit': item.pit_to_pit_in,
      'Collar to Hem': item.collar_to_hem_in,
      'Pit to Cuff': item.pit_to_cuff_in,
      Sleeve: item.sleeve_in,
      Waist: item.waist_in,
      'Inside Leg': item.inside_leg_in,
      Rise: item.rise_in,
      'Hem Width': item.hem_width_in,
    }

    const nonEmptyMeasurements = Object.entries(measurements)
      .filter(([_, value]) => value !== null && value !== undefined && value !== '')
      .map(([label, value]) => `${label}: ${value}"`)

    const flawsText = item.flaws?.trim()

    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      input: [
        {
          role: 'system',
          content:
            'You write concise, natural, professional marketplace copy for second-hand vintage clothing. Do not sound like AI. Do not invent brand, material, era, size, condition, measurements, or flaws. Use provided fields if present. Ignore blank fields. Use the first image as the front and the second image as the back if provided. Use image evidence only for visible details. Use the word vintage only where appropriate. Correct capitalisation, spelling and grammar in all generated output including condition notes. Output valid JSON only.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `Create listing copy using these item fields:
${JSON.stringify(fieldsUsed, null, 2)}

Condition notes / flaws, if provided:
${flawsText || 'NONE'}

Measurements, if provided:
${nonEmptyMeasurements.length ? nonEmptyMeasurements.join('\n') : 'NONE'}

Important rules:
- Generate a marketplace SEO title suitable for eBay, Vinted and Depop.
- Generate a concise professional description suitable for eBay, Vinted, Depop and website use.
- Do not mention flaws or condition notes inside the main description paragraph.
- If condition notes/flaws are provided, add them at the end under this exact header:
Condition Notes:
- Fix obvious spelling mistakes in condition notes.
- Correct sentence capitalisation and punctuation in condition notes.
- Keep the meaning of condition notes exactly the same.
- Do not soften, exaggerate or remove issues.
- If measurements are provided, add them at the end under this exact header:
Measurements (Inches):
- Each measurement must be on a new line.
- Format measurements exactly like:
Pit to Pit: 22"
Collar to Hem: 28"
- Do not add Condition Notes header if no flaws are provided.
- Do not add Measurements (Inches) header if no measurements are provided.
- Capitalise output professionally even if input fields are lowercase.
- Keep wording natural, concise and descriptive.
- Do not use hype phrases.
- Do not invent anything not visible or provided.

Return JSON with exactly these keys:
{
  "ai_title": "SEO marketplace title under 80 characters",
  "ai_description": "Main generated description followed by Condition Notes and Measurements sections only when relevant",
  "website_title": "Cleaner professional website product title, not keyword stuffed"
}`,
            },
            ...(imageUrls || []).slice(0, 2).map((url: string) => ({
              type: 'input_image' as const,
              image_url: url,
            })),
          ],
        },
      ],
    })

    const cleanedText = response.output_text
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim()

    const parsed = JSON.parse(cleanedText)

    return Response.json(parsed)
  } catch (error: any) {
    return Response.json(
      { error: error.message || 'AI generation failed' },
      { status: 500 }
    )
  }
}