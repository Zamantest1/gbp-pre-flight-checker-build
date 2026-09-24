import { NextResponse } from 'next/server'

const prompt = `You are an expert Google Business Profile moderator. Analyze the supplied image and caption. Treat the supplied image metadata as authoritative for pixel dimensions and orientation; do not guess or claim a portrait image is square. Google Business Profile photo guidance requires JPG/PNG, 10 KB–5 MB, and at least 250 × 250 pixels; 720 × 720 pixels is a common recommended target, but do not fail an image solely because it is not square. Distinguish hard technical failures from quality recommendations. An image can be landscape or portrait and still pass the technical minimum. 

Analyze the supplied image and caption. Return ONLY valid JSON with this exact shape:
{
  "textRatio": { "status": "Pass|Fail|Warning", "reason": "..." },
  "visualSafety": { "status": "Pass|Fail|Warning", "reason": "..." },
  "captionPolicy": { "status": "Pass|Fail|Warning", "reason": "..." },
  "qualityScore": 0,
  "improvedCaption": "...",
  "captionChanges": ["..."],
  "imageSuggestions": ["..."]
}
Keep improvedCaption concise and publishable. Automatically remove or rewrite links, phone numbers, keyword stuffing, and restricted claims. If the caption is compliant, return it unchanged and use an empty captionChanges array. Give 2-4 practical imageSuggestions, even when the image passes. Set qualityScore to an integer from 0 to 100 representing overall GBP publish-readiness: weigh policy compliance, image quality, text overlay, and caption clarity. Explain score-relevant issues in the existing reason and suggestion fields. Never include markdown fences.`

type RequestBody = { caption?: string; image?: string; mimeType?: string; apiKey?: string; provider?: 'openai' | 'gemini' | 'claude'; imageContext?: { width: number; height: number; orientation: 'square' | 'portrait' | 'landscape'; fileSizeBytes: number } | null }

function parseModelJson(text: string) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('The AI returned an invalid moderation report.')
  return JSON.parse(cleaned.slice(start, end + 1))
}

const REQUEST_TIMEOUT_MS = 45000

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as RequestBody
    if (!body.caption?.trim() || !body.image || !body.mimeType) return NextResponse.json({ error: 'Caption and image are required.' }, { status: 400 })
    if (!body.apiKey?.trim()) return NextResponse.json({ error: `Add your ${body.provider === 'gemini' ? 'Gemini' : body.provider === 'claude' ? 'Claude/VyceAI' : 'OpenAI'} API key in Settings before running AI moderation.` }, { status: 400 })

    const imageUrl = `data:${body.mimeType};base64,${body.image}`
    const imageContext = body.imageContext ? `Verified image metadata: ${body.imageContext.width} × ${body.imageContext.height}px, ${body.imageContext.orientation}, ${(body.imageContext.fileSizeBytes / 1024).toFixed(1)} KB.` : 'Verified image metadata was not provided.'
    const userContent = [{ type: 'text', text: `${imageContext}\nCaption to moderate:\n${body.caption}` }, { type: 'image_url', image_url: { url: imageUrl } }]
    let response: Response
    let text = ''

    if (body.provider === 'gemini') {
      const preferredModels = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash']
      const modelsResponse = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(body.apiKey)}`)
      const modelsData = await modelsResponse.json()
      if (!modelsResponse.ok) throw new Error(modelsData.error?.message ?? 'Gemini API key was rejected.')

      const availableModels = (modelsData.models ?? [])
        .filter((model: { name?: string; supportedGenerationMethods?: string[] }) => model.name?.startsWith('models/gemini-') && model.supportedGenerationMethods?.includes('generateContent'))
        .map((model: { name: string }) => model.name.replace(/^models\//, ''))
      const candidates = [...new Set([...preferredModels.filter((model) => availableModels.includes(model)), ...availableModels.filter((model: string) => /flash/i.test(model))])]
      if (!candidates.length) throw new Error('No Gemini model with image support is available for this API key.')

      const shuffledModels = candidates.sort(() => Math.random() - 0.5)
      let lastError = 'Gemini API request failed.'
      for (const model of shuffledModels) {
        response = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(body.apiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemInstruction: { parts: [{ text: prompt }] }, contents: [{ role: 'user', parts: [{ text: `${imageContext}\nCaption to moderate:\n${body.caption}` }, { inlineData: { mimeType: body.mimeType, data: body.image } }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }) })
        const data = await response.json()
        if (response.ok) {
          text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
          if (text) break
        }
        lastError = data.error?.message ?? `Gemini model ${model} failed.`
        if (response.status === 401 || response.status === 403) throw new Error('Gemini rejected this API key. Check that it is active and copied completely.')
      }
      if (!text) throw new Error(`Gemini could not complete the request after trying ${shuffledModels.length} available models. ${lastError}`)
    } else {
      const endpoint = body.provider === 'claude' ? 'https://api.selora.lol/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions'
      const model = body.provider === 'claude' ? 'claude-sonnet-5' : 'gpt-4o-mini'
      const messages = body.provider === 'claude'
        ? [{ role: 'system', content: prompt }, { role: 'user', content: userContent }]
        : [{ role: 'system', content: prompt }, { role: 'user', content: userContent }]
      response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${body.apiKey}` }, body: JSON.stringify({ model, temperature: 0.2, messages }) })
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
