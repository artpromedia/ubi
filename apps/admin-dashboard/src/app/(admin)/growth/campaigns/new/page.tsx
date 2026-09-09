import { CampaignForm } from '@/components/growth/CampaignForm';
export default function NewCampaignPage() {
  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center gap-3"><h1 className="font-heading text-xl font-semibold">Growth › Campaigns › New</h1><span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Draft · v1 · unsaved</span></div>
      <CampaignForm author="Bola A." />
    </div>
  );
}
