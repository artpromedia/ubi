import { AskPanel } from '@/components/travel/AskPanel';
/** /ask — full-width Ask UBI on web; transactions route to /ask/review/[id] which renders the same terms as the RN sheet (20b). */
export default function AskPage() { return <div className="mx-auto max-w-3xl p-6"><h1 className="mb-4 font-heading text-2xl font-semibold text-[#191414]">Ask UBI</h1><div className="[&>div]:w-full"><AskPanel context={{}} /></div></div>; }
