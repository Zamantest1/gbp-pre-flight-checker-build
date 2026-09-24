import { NextResponse } from 'next/server'

const prompt = `You are an expert Google Business Profile moderator. Analyze the supplied image and caption. Return ONLY valid JSON with this exact shape:
{
  "textRatio": { "status": "Pass|Fail|Warning", "reason": "..." },
  "visualSafety": { "status": "Pass|Fail|Warning", "reason": "..." },
  "captionPolicy": { "status": "Pass|Fail|Warning", "reason": "..." },
  "improvedCaption": "...",
  "captionChanges": ["..."],
  "imageSuggestions": ["..."]
}
Keep improvedCaption concise and publishable. Automatically remove or rewrite links, phone numbers, keyword stuffing, and restricted claims. If the caption is compliant, return it unchanged and use an empty captionChanges array. Give 2-4 practical imageSuggestions, even when the image passes. Never include markdown fences.`

type RequestBody = { caption?: string; image?: string; mimeType?: string; apiKey?: string; provider?: 'openai' | 'gemini' | 'claude' }

function parseModelJson(text: string) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('The AI returned an invalid moderation report.')
  return JSON.parse(cleaned.slice(start, end + 1))
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as RequestBody
    if (!body.caption?.trim() || !body.image || !body.mimeType) return NextResponse.json({ error: 'Caption and image are required.' }, { status: 400 })
    if (!body.apiKey?.trim()) return NextResponse.json({ error: `Add your ${body.provider === 'gemini' ? 'Gemini' : body.provider === 'claude' ? 'Claude/VyceAI' : 'OpenAI'} API key in Settings before running AI moderation.` }, { status: 400 })

    const imageUrl = `data:${body.mimeType};base64,${body.image}`
    const userContent = [{ type: 'text', text: `Caption to moderate:\n${body.caption}` }, { type: 'image_url', image_url: { url: imageUrl } }]
    let response: Response
    let text: string

    if (body.provider === 'gemini') {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(body.apiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemInstruction: { parts: [{ text: prompt }] }, contents: [{ role: 'user', parts: [{ text: `Caption to moderate:\n${body.caption}` }, { inlineData: { mimeType: body.mimeType, data: body.image } }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error?.message ?? 'Gemini API request failed.')
      text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    } else {
      const endpoint = body.provider === 'claude' ? 'https://vyceai.com/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions'
      const model = body.provider === 'claude' ? 'claude-sonnet-4-6' : 'gpt-4o-mini'
      response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${body.apiKey}` }, body: JSON.stringify({ model, temperature: 0.2, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: prompt }, { role: 'user', content: userContent }] }) })
      const data = await response.json()
      if (!response.ok) {
        const serviceName = body.provider === 'claude' ? 'VyceAI' : 'OpenAI'
        const apiError = data.error?.message ?? `${serviceName} API request failed.`
        if (response.status === 401) throw new Error(`${serviceName} rejected this API key. Check that it is active and copied completely.`)
        if (response.status === 429 && /credit|billing|quota|余额/i.test(apiError)) throw new Error(`${serviceName} accepted the key but this account has no API credits or quota. Check your account billing, then try again.`)
        if (response.status === 429) throw new Error(`${serviceName} is temporarily rate-limiting this request. Wait a moment and try again.`)
        throw new Error(apiError)
      }
      text = data.choices?.[0]?.message?.content ?? ''
    }

    return NextResponse.json(parseModelJson(text))
  } catch (error) {
    console.error('[v0] GBP validation failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'AI validation failed. Please try again.' }, { status: 500 })
  }
}
