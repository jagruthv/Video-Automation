import { PulseDashboard } from "@/components/ui/pulse-dashboard";

export default function AnalyticsPage() {
  return (
    <main className="min-h-screen bg-[#0a0a0a] pt-24 pb-32">
      <div className="absolute inset-x-0 top-0 h-[40vh] bg-gradient-to-b from-blue-500/5 to-transparent pointer-events-none" />
      <PulseDashboard />
    </main>
  );
}
