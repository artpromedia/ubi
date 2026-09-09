'use client';
import { useEffect, useState } from 'react';
import { Button } from '@ubi/ui';
/** Board 23f — web-to-app handoff that keeps attribution. Server stores the token against the account for 30 d; the web page stays fully usable. */
export function HandoffBanner({ tripId, referralCode, campaign }: { tripId: string; referralCode?: string; campaign?: string }) {
  const [token, setToken] = useState<string | undefined>();
  useEffect(() => { fetch('/api/attribution/token', { method: 'POST', body: JSON.stringify({ referralCode, campaign }) }).then(r => r.json()).then(j => setToken(j.token)).catch(() => undefined); }, [referralCode, campaign]);
  const appLink = 'https://links.ubi.africa/trips/' + tripId + (token ? '?t=' + token : '');
  return (
    <div data-testid="web.handoff.banner" className="flex items-center gap-3 bg-[#191414] px-4 py-3 text-white">
      <div className="h-9 w-9 shrink-0 rounded-[10px] bg-[#1DB954]" aria-hidden />
      <div className="flex-1"><div className="text-[13px] font-semibold">Manage this trip in the UBI app</div><div className="text-[11.5px] text-[#A3A3A3]">Live updates, boarding pass, rides — your referral code carries over</div></div>
      <Button asChild size="sm" className="bg-[#1DB954] text-[#191414] hover:bg-[#18A349]"><a href={appLink} data-testid="web.handoff.open">Open</a></Button>
    </div>
  );
}
export function HandoffFallbackNote({ referralCode, campaign }: { referralCode?: string; campaign?: string }) {
  return <p data-testid="web.handoff.fallback" className="border-t border-[#E5E5E5] bg-white px-4 py-3 text-[11.5px] leading-relaxed text-[#666]">"Open" tries the installed app first (App Link / Universal Link). If it isn't installed you go to the store; your code <span className="font-mono text-[#191414]">{referralCode ?? '—'}</span> and campaign <span className="font-mono text-[#191414]">{campaign ?? '—'}</span> are kept server-side against your account for 30 days — nothing is lost if the store link drops them. Everything above also works right here.</p>;
}
