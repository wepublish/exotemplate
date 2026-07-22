import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * Agent-Chat-Bruecke: leitet eine Nutzer-Nachricht an den FaaS-Hermes-Agenten weiter.
 *
 * Status 2026-06-02: Der FaaS-Agent (eigenes Hermes-Profil + Gateway) wird erst NACH
 * dem qwen-v3-Pool aktiviert. Bis dahin antwortet diese Route mit `status: 'inactive'`,
 * damit das Chatfenster einen sauberen Wartezustand zeigt statt eines Fehlers.
 *
 * Bei der Aktivierung: `FAAS_AGENT_ENABLED=true` setzen und `HERMES_API_URL` /
 * `HERMES_API_KEY` auf den FaaS-Gateway-Endpoint zeigen. Die App laeuft `--network host`,
 * erreicht den Agenten also lokal (z. B. http://127.0.0.1:<port>). Payload-Form beim
 * Scharfschalten gegen den laufenden Agenten verifizieren.
 */

type ChatResponse =
  | { status: 'ok'; reply: string }
  | { status: 'inactive'; note: string }
  | { status: 'error'; note: string }

export default async function handler(req: NextApiRequest, res: NextApiResponse<ChatResponse>) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', note: 'Nur POST.' })
  }

  const { message } = (req.body ?? {}) as { message?: string }
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ status: 'error', note: 'Leere Nachricht.' })
  }

  // Wer fragt? Cloudflare-Access-Identitaet (Jolanda oder Ramona) — wird dem Agenten
  // mitgegeben, sobald er aktiv ist (steuert auch die proaktive Assistenz).
  const user =
    (req.headers['cf-access-authenticated-user-email'] as string | undefined) ?? 'team'

  if (process.env.FAAS_AGENT_ENABLED !== 'true') {
    return res.status(200).json({
      status: 'inactive',
      note: 'Der FaaS-Agent wird nach dem qwen-v3-Pool aktiviert. Dann steuerst du ihn hier.',
    })
  }

  try {
    const reply = await callFaasAgent(message.trim(), user)
    return res.status(200).json({ status: 'ok', reply })
  } catch (err) {
    return res.status(200).json({
      status: 'error',
      note: 'Agent gerade nicht erreichbar: ' + (err instanceof Error ? err.message : 'unbekannt'),
    })
  }
}

/**
 * Ruft den FaaS-Hermes-Agenten ueber seinen lokalen API-Endpoint auf.
 * Endpoint/Payload werden bei der Aktivierung gegen den laufenden Agenten fixiert.
 */
async function callFaasAgent(message: string, user: string): Promise<string> {
  const base = process.env.HERMES_API_URL
  if (!base) throw new Error('HERMES_API_URL nicht gesetzt')
  const resp = await fetch(base, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.HERMES_API_KEY ? { Authorization: `Bearer ${process.env.HERMES_API_KEY}` } : {}),
    },
    body: JSON.stringify({ profile: 'faas', message, user }),
  })
  if (!resp.ok) throw new Error(`Hermes HTTP ${resp.status}`)
  const data = (await resp.json()) as { reply?: string; text?: string; output?: string }
  return data.reply ?? data.text ?? data.output ?? ''
}
