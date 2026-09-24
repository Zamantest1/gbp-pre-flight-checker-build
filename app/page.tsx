'use client'

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  FileImage,
  Gauge,
  ImagePlus,
  KeyRound,
  Link2,
  Loader2,
  LockKeyhole,
  MessageSquareText,
  Settings2,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
  XCircle,
} from 'lucide-react'

const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_CAPTION_LENGTH = 1500
const SYSTEM_PROMPT = `You are an elite Google Business Profile moderator. Analyze this image and text. 1) Estimate what percentage of the image is covered by text overlays. If over 10%, flag it. 2) Check if the image looks like a generic stock photo or contains medical, violent, or sensitive imagery. 3) Check the text for keyword stuffing, unnatural phrasing, or mentions of restricted industries (alcohol, gambling, adult, pharma). Return ONLY a JSON object with this exact structure: { "textRatio": { "status": "Pass|Fail", "reason": "..." }, "visualSafety": { "status": "Pass|Fail", "reason": "..." }, "captionPolicy": { "status": "Pass|Fail", "reason": "..." } }`

type Status = 'Pass' | 'Fail' | 'Warning'
type Check = { status: Status; reason: string }
type Report = { textRatio: Check; visualSafety: Check; captionPolicy: Check; imageQuality: Check; captionQuality: Check; localRelevance: Check }
type AIResult = Report & { qualityScore: number; improvedCaption: string; captionChanges: string[]; imageSuggestions: string[] }

type HardRules = {
  image: { status: Status; detail: string }
  caption: { status: Status; detail: string }
  links: { status: Status; detail: string }
  phone: { status: Status; detail: string }
}

const initialRules: HardRules = {
  image: { status: 'Warning', detail: 'Waiting for an image' },
  caption: { status: 'Warning', detail: 'Waiting for caption' },
  links: { status: 'Warning', detail: 'No caption to check' },
  phone: { status: 'Warning', detail: 'No caption to check' },
}

const initialReport: Report = {
  textRatio: { status: 'Warning', reason: 'Run validation to analyze text coverage.' },
  visualSafety: { status: 'Warning', reason: 'Run validation to analyze visual safety.' },
  captionPolicy: { status: 'Warning', reason: 'Run validation to analyze caption policy.' },
  imageQuality: { status: 'Warning', reason: 'Run validation to assess resolution, composition, and visual quality.' },
  captionQuality: { status: 'Warning', reason: 'Run validation to assess clarity, relevance, and call-to-action quality.' },
  localRelevance: { status: 'Warning', reason: 'Run validation to assess whether the post is useful and relevant to local customers.' },
}

function StatusIcon({ status }: { status: Status }) {
  if (status === 'Pass') return <CheckCircle2 className="size-[18px] text-emerald-600" aria-hidden="true" />
  if (status === 'Fail') return <XCircle className="size-[18px] text-red-500" aria-hidden="true" />
  return <AlertCircle className="size-[18px] text-amber-500" aria-hidden="true" />
}

function StatusBadge({ status }: { status: Status }) {
  const styles = {
    Pass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    Fail: 'border-red-200 bg-red-50 text-red-700',
    Warning: 'border-amber-200 bg-amber-50 text-amber-700',
  }
  return <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${styles[status]}`}>{status}</span>
}

function RuleRow({ label, detail, status }: { label: string; detail: string; status: Status }) {
  return (
    <div className="flex items-start gap-3 border-b border-slate-100 py-4 last:border-0 last:pb-0 first:pt-0">
      <StatusIcon status={status} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] font-semibold text-slate-900">{label}</p>
          <StatusBadge status={status} />
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
      </div>
    </div>
  )
}

export default function Page() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [dimensions, setDimensions] = useState<string>('')
  const [imageMetrics, setImageMetrics] = useState<{ width: number; height: number; orientation: 'square' | 'portrait' | 'landscape' } | null>(null)
  const [caption, setCaption] = useState('')
  const [rules, setRules] = useState(initialRules)
  const [report, setReport] = useState(initialReport)
  const [apiKey, setApiKey] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [aiResult, setAiResult] = useState<AIResult | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showFullCaption, setShowFullCaption] = useState(false)
  const [screen, setScreen] = useState<'form' | 'report'>('form')

  useEffect(() => {
    setApiKey(window.localStorage.getItem('gbp-api-key') ?? '')
  }, [])

  function saveSettings() {
    window.localStorage.setItem('gbp-api-key', apiKey)
    setSettingsOpen(false)
    setNotice('Settings saved securely in this browser.')
    window.setTimeout(() => setNotice(null), 3000)
  }

  async function copyImprovedCaption() {
    if (!aiResult?.improvedCaption) return
    await navigator.clipboard.writeText(aiResult.improvedCaption)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  function loadFile(nextFile: File) {
    if (!['image/jpeg', 'image/png'].includes(nextFile.type)) {
      setNotice('Please choose a JPG or PNG image.')
      return
    }
    if (nextFile.size > MAX_FILE_SIZE) {
      setFile(nextFile)
      setPreview(null)
      setImageMetrics(null)
      setRules((current) => ({ ...current, image: { status: 'Fail', detail: 'Image exceeds the 5 MB limit.' } }))
      setNotice('This image is over the 5 MB limit.')
      return
    }
    if (nextFile.size < 10 * 1024) {
      setFile(nextFile)
      setPreview(null)
      setImageMetrics(null)
      setRules((current) => ({ ...current, image: { status: 'Fail', detail: 'Image is under Google\'s 10 KB minimum.' } }))
      setNotice('Google recommends Business Profile photos be at least 10 KB.')
      return
    }
    setFile(nextFile)
    const reader = new FileReader()
    reader.onload = () => setPreview(reader.result as string)
    reader.readAsDataURL(nextFile)
    const image = new Image()
    image.onload = () => {
      const width = image.naturalWidth
      const height = image.naturalHeight
      const orientation = width === height ? 'square' : width > height ? 'landscape' : 'portrait'
      setDimensions(`${width} × ${height}px · ${orientation}`)
      setImageMetrics({ width, height, orientation })
      if (width < 250 || height < 250) {
        setRules((current) => ({ ...current, image: { status: 'Fail', detail: `${width} × ${height}px · below Google\'s 250 × 250px minimum` } }))
        setNotice('This image is too small. Google Business Profile photos must be at least 250 × 250 pixels.')
      } else {
        setRules((current) => ({ ...current, image: { status: 'Pass', detail: `${(nextFile.size / 1024 / 1024).toFixed(2)} MB · ${width} × ${height}px · ${orientation}` } }))
      }
      URL.revokeObjectURL(image.src)
    }
    image.onerror = () => {
      setImageMetrics(null)
      setRules((current) => ({ ...current, image: { status: 'Fail', detail: 'Could not read image dimensions.' } }))
      setNotice('This image could not be read. Please choose another JPG or PNG.')
    }
    image.src = URL.createObjectURL(nextFile)
    setReport(initialReport)
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0]
    if (nextFile) loadFile(nextFile)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    const nextFile = event.dataTransfer.files[0]
    if (nextFile) loadFile(nextFile)
  }

  function checkRules(): HardRules {
    const hasLink = /https?:\/\/|www\.|\bcom\b/i.test(caption)
    const hasPhone = /(\+?\d[\d .()-]{7,}\d)/.test(caption)
    return {
      image: file ? (file.size < 10 * 1024 ? { status: 'Fail', detail: 'Image is under Google\'s 10 KB minimum.' } : file.size > MAX_FILE_SIZE ? { status: 'Fail', detail: 'Image exceeds the 5 MB limit.' } : !imageMetrics ? { status: 'Warning', detail: 'Still reading image dimensions.' } : imageMetrics.width < 250 || imageMetrics.height < 250 ? { status: 'Fail', detail: `${dimensions} · below Google\'s 250 × 250px minimum` } : { status: 'Pass', detail: `${(file.size / 1024 / 1024).toFixed(2)} MB · ${dimensions}` }) : { status: 'Fail', detail: 'An image is required.' },
      caption: caption.length <= MAX_CAPTION_LENGTH ? { status: 'Pass', detail: `${caption.length} / ${MAX_CAPTION_LENGTH} characters` } : { status: 'Fail', detail: `${caption.length} characters is over the 1,500 character limit.` },
      links: hasLink ? { status: 'Fail', detail: 'Links are not allowed in GBP post captions.' } : { status: 'Pass', detail: 'No URLs or domain links detected.' },
      phone: hasPhone ? { status: 'Fail', detail: 'Phone numbers are not allowed in GBP post captions.' } : { status: 'Pass', detail: 'No phone number detected.' },
    }
  }

  function validateAnotherPost() {
    setScreen('form')
    setAiResult(null)
    setProgress(0)
    setReport(initialReport)
    setRules(initialRules)
    setCaption('')
    setFile(null)
    setPreview(null)
    setDimensions('')
    setImageMetrics(null)
    setNotice(null)
    setShowFullCaption(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function runValidation() {
    const nextRules = checkRules()
    setRules(nextRules)
    setNotice(null)
    setAiResult(null)
    if (!file || nextRules.image.status !== 'Pass' || nextRules.caption.status === 'Fail') {
      setNotice('Add an image at least 250 × 250 pixels and keep the caption under 1,500 characters before running AI moderation.')
      return
    }
    if (!apiKey.trim()) {
      setNotice('Add your Gemini API key in Settings before running AI moderation.')
      setSettingsOpen(true)
      return
    }
    setLoading(true)
    setProgress(12)
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = () => reject(new Error('Could not read image'))
        reader.readAsDataURL(file)
      })
      setProgress(38)
      const response = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption, image: base64, mimeType: file.type, apiKey: apiKey.trim(), provider: 'gemini', imageContext: imageMetrics ? { ...imageMetrics, fileSizeBytes: file.size } : null }),
      })
      setProgress(78)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'AI validation failed. Please try again.')
      const result = data as AIResult
      setReport({ textRatio: result.textRatio, visualSafety: result.visualSafety, captionPolicy: result.captionPolicy, imageQuality: result.imageQuality, captionQuality: result.captionQuality, localRelevance: result.localRelevance })
      setAiResult(result)
      if (result.improvedCaption && result.improvedCaption !== caption) setCaption(result.improvedCaption)
      setProgress(100)
      setScreen('report')
    } catch (error) {
      setProgress(0)
      setNotice(error instanceof Error ? error.message : 'Something went wrong while validating.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#f8fafc] text-slate-950">
      <header className="border-b border-slate-200/80 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm"><Gauge className="size-[18px]" /></div>
            <div><p className="text-sm font-bold tracking-tight">GBP Pre-Flight Checker</p><p className="hidden text-[11px] text-slate-400 sm:block">Publish with confidence</p></div>
          </div>
          <div className="relative">
            <button onClick={() => setSettingsOpen((open) => !open)} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50" aria-expanded={settingsOpen}><Settings2 className="size-4" /> Settings <ChevronDown className="size-3.5 text-slate-400" /></button>
            {settingsOpen && <div className="absolute right-0 z-20 mt-2 w-[min(340px,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-4 shadow-xl"><div className="mb-4 flex items-start justify-between"><div><p className="text-sm font-semibold">Gemini connection</p><p className="mt-1 text-xs leading-5 text-slate-500">Your key is saved only in this browser&apos;s cache.</p></div><LockKeyhole className="size-4 text-slate-400" /></div><div className="mb-3 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-800">Google Gemini API</div><label className="text-xs font-semibold text-slate-700" htmlFor="api-key">Gemini API key</label><div className="relative mt-1.5"><KeyRound className="absolute left-3 top-2.5 size-4 text-slate-400" /><input id="api-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Paste your Gemini API key" className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs outline-none ring-offset-2 focus:border-slate-400 focus:ring-2 focus:ring-slate-200" /></div><button onClick={saveSettings} className="mt-3 w-full rounded-lg bg-slate-950 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-800">Save Gemini settings</button></div>}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 pb-8 pt-2 sm:px-8 sm:pb-10 sm:pt-3">
        <div className="mb-6 max-w-2xl sm:mb-8"><div className="mb-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-500"><Sparkles className="size-3.5 text-indigo-500" /> Client-side validation</div><h1 className="text-3xl font-bold tracking-[-0.04em] text-slate-950 sm:text-4xl">Check your post before it goes live.</h1><p className="mt-3 text-sm leading-6 text-slate-500 sm:text-base">Catch GBP policy issues in seconds with instant hard rules and optional AI-powered moderation.</p></div>
        {notice && <div role="status" className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800"><span className="flex items-center gap-2"><AlertCircle className="size-4" /> {notice}</span><button onClick={() => setNotice(null)} aria-label="Dismiss notification"><X className="size-4" /></button></div>}
        {screen === 'report' && aiResult && <section className="mb-5 rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-emerald-50 p-5 shadow-[0_8px_30px_rgba(79,70,229,0.08)] sm:p-6"><div className="flex flex-wrap items-center justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-indigo-600"><CheckCircle2 className="size-4" /> Validation complete</div><h2 className="text-2xl font-bold tracking-[-0.03em] text-slate-950">Your post is ready for review.</h2><p className="mt-1 text-sm text-slate-600">Use the recommendations below to make this GBP post clearer, safer, and more compliant.</p></div><div className="flex items-center gap-3"><div className="text-right"><p className="text-3xl font-bold tracking-tight text-slate-950">{Math.max(0, Math.min(100, Math.round(aiResult.qualityScore)))}</p><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">quality score</p></div><button onClick={validateAnotherPost} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800"><UploadCloud className="size-4" /> Validate another post</button></div></div></section>}
        {loading && <section className="mx-auto max-w-xl rounded-2xl border border-indigo-100 bg-white p-8 text-center shadow-[0_8px_30px_rgba(15,23,42,0.06)] sm:p-12" aria-live="polite"><div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600"><Loader2 className="size-7 animate-spin" /></div><p className="text-lg font-bold text-slate-950">Preparing your validation report</p><p className="mt-2 text-sm text-slate-500">Checking the image, caption, and GBP publishing risks.</p><div className="mt-7 flex items-center justify-between text-xs font-semibold text-indigo-700"><span>{progress < 38 ? 'Checking image' : progress < 78 ? 'Reviewing caption' : 'Preparing recommendations'}</span><span>{progress}%</span></div><div className="mt-2 h-2.5 overflow-hidden rounded-full bg-indigo-50"><div className="h-full rounded-full bg-indigo-500 transition-all duration-500" style={{ width: `${progress}%` }} /></div></section>}
        <div className={`${loading ? 'hidden' : ''} grid items-start gap-5 lg:gap-6 ${screen === 'report' ? 'lg:grid-cols-1' : 'lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]'}`}>
          <section className={`${screen === 'report' ? 'hidden' : ''} rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.03)] sm:p-6`}><div className="mb-5"><p className="text-base font-bold">Post details</p><p className="mt-1 text-xs text-slate-500">Upload an image and add the caption you plan to publish.</p></div>
            <div onClick={() => fileInputRef.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={handleDrop} className={`group relative flex min-h-[214px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed transition ${dragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-slate-50/70 hover:border-slate-400 hover:bg-slate-50'}`}>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" onChange={handleFileChange} className="sr-only" />
              {preview ? <><img src={preview} alt="Selected GBP post preview" className="absolute inset-0 size-full object-contain p-3" /><div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/70 to-transparent px-4 pb-3 pt-8 text-xs text-white"><span className="font-semibold">{file?.name}</span><span className="ml-2 text-white/70">{dimensions}</span></div></> : <><div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm"><UploadCloud className="size-5" /></div><p className="text-sm font-semibold text-slate-700">Drop your image here</p><p className="mt-1 text-xs text-slate-400">or click to browse · JPG or PNG, max 5 MB</p></>}
            </div>
            <div className="mt-5"><div className="mb-2 flex items-center justify-between"><label htmlFor="caption" className="text-xs font-bold text-slate-700">Post caption</label><span className={`text-[11px] font-medium ${caption.length > MAX_CAPTION_LENGTH ? 'text-red-500' : 'text-slate-400'}`}>{caption.length} / {MAX_CAPTION_LENGTH}</span></div><textarea id="caption" value={caption} maxLength={2000} onChange={(event) => setCaption(event.target.value)} placeholder="Write the caption you plan to publish..." className="min-h-[180px] w-full resize-none rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-sm leading-6 outline-none ring-offset-2 transition placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200" /></div>
            <button onClick={runValidation} disabled={loading} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70">{loading ? <><Loader2 className="size-4 animate-spin" /> Analyzing post...</> : <><ShieldCheck className="size-4" /> Run GBP Validation</>}</button>
            {loading && <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/70 p-3" aria-live="polite"><div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-indigo-700"><span>AI validation in progress</span><span>{progress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-indigo-500 transition-all duration-500" style={{ width: `${progress}%` }} /></div><p className="mt-2 text-[11px] text-indigo-600">Checking caption policy, image safety, and creative quality...</p></div>}
            <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-slate-400"><LockKeyhole className="size-3" /> Your image is processed in memory and never uploaded to our servers.</p>
          </section>

          <section className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-3">
            {aiResult && <div className="order-first rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.07)] sm:p-5"><div className="mb-4 flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Sparkles className="size-4 text-indigo-500" /><p className="text-base font-bold">AI action plan</p></div><p className="mt-1 text-xs text-slate-500">Ready-to-use improvements from your validation.</p></div><div className="flex shrink-0 items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${aiResult.qualityScore >= 80 ? 'bg-emerald-50 text-emerald-700' : aiResult.qualityScore >= 60 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>{Math.max(0, Math.min(100, Math.round(aiResult.qualityScore)))} / 100</span><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">Complete</span></div></div><div className="grid gap-3 xl:grid-cols-2"><div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4"><div className="flex items-center gap-2"><MessageSquareText className="size-4 text-emerald-600" /><p className="text-sm font-bold text-emerald-950">Caption improvement</p></div><div className="mt-3 rounded-xl border border-emerald-100 bg-white/90 p-3"><div className="flex items-center justify-between gap-3"><p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700">Ready to publish</p><button onClick={copyImprovedCaption} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-50" aria-label="Copy improved caption"><Clipboard className="size-3.5" /> {copied ? 'Copied' : 'Copy'}</button></div><p className={`mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 ${showFullCaption ? '' : 'line-clamp-6'}`}>{aiResult.improvedCaption}</p>{aiResult.improvedCaption.length > 420 && <button onClick={() => setShowFullCaption((open) => !open)} className="mt-2 text-[11px] font-semibold text-emerald-700 hover:text-emerald-900">{showFullCaption ? 'Show less' : 'See more'}</button>}</div><div className="hidden" aria-hidden="true"><button tabIndex={-1} onClick={copyImprovedCaption} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-50" aria-label="Copy improved caption"><Clipboard className="size-3.5" /> {copied ? 'Copied' : 'Copy'}</button></div>{aiResult.captionChanges.length > 0 && <div className="mt-3 border-t border-emerald-200/70 pt-3"><p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700">What changed</p><ul className="flex flex-col gap-1.5 text-xs leading-5 text-emerald-800">{aiResult.captionChanges.map((change) => <li key={change}>• {change}</li>)}</ul></div>}</div><div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4"><div className="flex items-center gap-2"><ImagePlus className="size-4 text-indigo-600" /><p className="text-sm font-bold text-indigo-950">Image suggestions</p></div><p className="mt-1.5 text-xs text-indigo-700">Make the creative clearer, more relevant, and easier to trust.</p><ul className="mt-3 flex flex-col gap-2 text-xs leading-5 text-indigo-900">{aiResult.imageSuggestions.map((suggestion) => <li key={suggestion} className="flex gap-2"><span className="font-bold">{`→`}</span><span>{suggestion}</span></li>)}</ul></div></div></div>}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_12px_rgba(15,23,42,0.03)] sm:p-6"><div className="mb-5 flex items-start justify-between"><div><p className="text-base font-bold">Hard rules</p><p className="mt-1 text-xs text-slate-500">Instant checks run before any AI analysis.</p></div><div className="flex size-8 items-center justify-center rounded-lg bg-slate-100"><Check className="size-4 text-slate-600" /></div></div><div><RuleRow label="Image size" detail={rules.image.detail} status={rules.image.status} /><RuleRow label="Caption length" detail={rules.caption.detail} status={rules.caption.status} /><RuleRow label="URLs & links" detail={rules.links.detail} status={rules.links.status} /><RuleRow label="Phone numbers" detail={rules.phone.detail} status={rules.phone.status} /></div></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_12px_rgba(15,23,42,0.03)] sm:p-6"><div className="mb-5 flex items-start justify-between"><div><p className="text-base font-bold">AI moderation report</p><p className="mt-1 text-xs text-slate-500">Deeper checks for imagery and language.</p></div><div className="flex size-8 items-center justify-center rounded-lg bg-indigo-50"><Sparkles className="size-4 text-indigo-500" /></div></div><div><RuleRow label="Text-to-image ratio" detail={report.textRatio.reason} status={report.textRatio.status} /><RuleRow label="SafeSearch & quality" detail={report.visualSafety.reason} status={report.visualSafety.status} /><RuleRow label="Image quality & composition" detail={report.imageQuality.reason} status={report.imageQuality.status} /><RuleRow label="Caption policy" detail={report.captionPolicy.reason} status={report.captionPolicy.status} /><RuleRow label="Caption clarity & CTA" detail={report.captionQuality.reason} status={report.captionQuality.status} /><RuleRow label="Local customer relevance" detail={report.localRelevance.reason} status={report.localRelevance.status} /></div></div>
          </section>
        </div>
        <footer className="pt-12 text-center text-xs text-slate-400">Built by <a href="https://shomikujzaman.vercel.app" target="_blank" rel="noreferrer" className="font-medium text-slate-500 underline decoration-slate-300 underline-offset-2 transition hover:text-slate-800">shomik</a></footer>
      </div>
    </main>
  )
}
