import { useRef, useState, useEffect } from 'react'
import { Send, Bot, User, Sparkles } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Msg = { role: 'user' | 'agent' | 'system'; text: string }

const BEISPIELE = [
  'Wie steht bajour?',
  'Welche Fristen laufen diese Woche?',
  'Bereite die Top-5-Matches von neue_wege als Gesuche vor',
  'Was ist gerade zu tun?',
]

export function AgentChat({ className }: { className?: string } = {}) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, busy])

  async function send(text: string) {
    const m = text.trim()
    if (!m || busy) return
    setInput('')
    setMsgs(prev => [...prev, { role: 'user', text: m }])
    setBusy(true)
    try {
      const resp = await fetch('/api/agent-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: m }),
      })
      const data = await resp.json()
      if (data.status === 'ok') {
        setMsgs(prev => [...prev, { role: 'agent', text: data.reply || '(leere Antwort)' }])
      } else {
        setMsgs(prev => [...prev, { role: 'system', text: data.note || 'Keine Antwort.' }])
      }
    } catch {
      setMsgs(prev => [...prev, { role: 'system', text: 'Verbindung zum Agenten fehlgeschlagen.' }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className={cn('flex flex-col bg-white shadow-sm', className ?? 'h-[calc(100vh-220px)] min-h-[420px]')}>
      {/* Verlauf */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {msgs.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-4 text-slate-400">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-500">
              <Sparkles className="w-6 h-6" />
            </div>
            <div className="max-w-md">
              <p className="text-sm text-slate-600 font-medium mb-1">Der Gerät</p>
              <p className="text-sm text-slate-400">
                Deine Kommandozentrale. Gib Aufträge, frag nach dem Stand, gib Freigaben — du und
                Ramona arbeitet hier gemeinsam mit dem Agenten.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {BEISPIELE.map(b => (
                <button
                  key={b}
                  onClick={() => send(b)}
                  className="text-xs px-3 py-1.5 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50"
                >
                  {b}
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m, i) => {
          if (m.role === 'system') {
            return (
              <div key={i} className="mx-auto max-w-md text-center text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {m.text}
              </div>
            )
          }
          const isUser = m.role === 'user'
          return (
            <div key={i} className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isUser ? 'bg-slate-100 text-slate-600' : 'bg-indigo-50 text-indigo-600'}`}>
                {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>
              <div className={`rounded-2xl px-4 py-2.5 text-sm max-w-[75%] whitespace-pre-wrap ${isUser ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}>
                {m.text}
              </div>
            </div>
          )
        })}

        {busy && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4" />
            </div>
            <div className="rounded-2xl px-4 py-2.5 bg-slate-50 text-slate-400 text-sm">…</div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Eingabe */}
      <div className="border-t border-slate-100 p-3 flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send(input)
            }
          }}
          placeholder="Frag Der Gerät …"
          disabled={busy}
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-50"
        />
        <Button onClick={() => send(input)} disabled={busy || !input.trim()} size="icon">
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </Card>
  )
}
