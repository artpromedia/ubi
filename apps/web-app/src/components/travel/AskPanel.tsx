'use client';
import { useState } from 'react';
import { Card } from '@ubi/ui';
/** Board 23f — Ask UBI beside the results. Same rules as the app: sources cited, live prices aged, transactions only via the review flow (opens /ask/review/[id]). */
export function AskPanel({ context }: { context: { searchId?: string } }) {
  const [msgs, setMsgs] = useState<{ role: 'user' | 'assistant'; text: string; sources?: string[] }[]>([]);
  const [input, setInput] = useState('');
  const send = async () => {
    if (!input.trim()) return; const text = input; setInput(''); setMsgs(m => [...m, { role: 'user', text }]);
    const r = await fetch('/api/ask/messages', { method: 'POST', body: JSON.stringify({ text, context }) }); const j = await r.json() as { text: string; sources?: string[] };
    setMsgs(m => [...m, { role: 'assistant', text: j.text, sources: j.sources }]);
  };
  return (
    <Card data-testid="web.ask.panel" className="flex w-[320px] shrink-0 flex-col overflow-hidden rounded-2xl">
      <div className="flex items-center gap-2 border-b border-[#F0F0F0] p-4"><span className="inline-block h-4 w-4 rotate-45 rounded-sm bg-[#1DB954]" aria-hidden /><span className="font-heading text-sm font-semibold text-[#191414]">Ask UBI</span><span className="ml-auto text-[11px] text-[#666]">same rules as the app</span></div>
      <div className="flex-1 space-y-2.5 overflow-auto p-4 text-[12.5px] leading-relaxed text-[#191414]">
        {msgs.length === 0 ? <p className="text-[#666]">Ask about these flights — which lets you change the day for free, what a Saver refund covers, or whether protection is offered.</p> : null}
        {msgs.map((m, i) => m.role === 'user' ? <div key={i} className="ml-8 rounded-xl rounded-br-sm bg-[#F5F5F5] px-2.5 py-2">{m.text}</div> : <div key={i}><p>{m.text}</p>{m.sources?.length ? <div className="mt-2 border-l-2 border-[#E5E5E5] pl-2.5 text-[11.5px] text-[#666]">Sources: {m.sources.join(' · ')}</div> : null}</div>)}
      </div>
      <form className="border-t border-[#F0F0F0] p-3" onSubmit={e => { e.preventDefault(); void send(); }}><input value={input} onChange={e => setInput(e.target.value)} placeholder="Ask about these flights…" className="h-10 w-full rounded-full bg-[#F5F5F5] px-3.5 text-[12.5px] outline-none" /></form>
    </Card>
  );
}
