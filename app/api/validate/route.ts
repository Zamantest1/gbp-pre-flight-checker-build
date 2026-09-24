import { generateText, gateway } from 'ai'
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
Keep improvedCaption concise and publishable. If the caption already follows policy, return it unchanged and use an empty captionChanges array. Give 2-4 practical imageSuggestions, even when the image passes. Never include markdown fences.`

export async function POST(request: Request) {
  try {
    const body = await request.json() as { caption?: string; image?: string; mimeType?: string }
    if (!body.caption || !body.image || !body.mimeType) {
      return NextResponse.json({ error: 'Caption and image are required.' }, { status: 400 })
    }

    const result = await generateText({
      model: gateway('google/gemini-2.5-flash'),
      temperature: 0.2,
      system: prompt,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `Caption: ${body.caption}` },
          { type: 'image', image: body.image, mediaType: body.mimeType },
        ],
      }],
    })

    const cleaned = result.text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
    return NextResponse.json(JSON.parse(cleaned))
  } catch (error) {
    console.error('[v0] GBP validation failed:', error)
    return NextResponse.json({ error: 'AI validation failed. Please try again.' }, { status: 500 })
  }
}
