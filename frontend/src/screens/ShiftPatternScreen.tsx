import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useMetricsStore } from "@/stores/useMetricsStore";

export function ShiftPatternScreen() {
  // Prefetched by ScreenManager and kept live by shift_pattern_data messages (useDataFeed)
  const shiftData = useMetricsStore((s) => s.shiftPattern) ?? [];
  const firstLabel = shiftData[0]?.time ?? "";
  const lastHour = shiftData.length ? Number(shiftData[shiftData.length - 1].time.slice(0, 2)) : NaN;
  const endLabel = Number.isFinite(lastHour) ? `${String((lastHour + 1) % 24).padStart(2, "0")}:00` : "";

  return (
    <div data-fit className="flex flex-col h-full min-h-0 bg-zinc-950 text-white overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col p-8">
        <div className="mb-6">
          <h1 className="text-9xl font-bold tracking-tight">Skiftmönster</h1>
          <p className="text-6xl text-zinc-400 mt-2">
            Körtid <span className="text-[#22c55e]">■</span> vs stopptid <span className="text-[#ef4444]">■</span>
            {shiftData.length > 0 && ` – ${shiftData.length} timmars skift`}
          </p>
        </div>

        {/* Chart takes up the rest of the space */}
        <div className="flex-1 min-h-0 bg-zinc-900 border border-zinc-800 rounded-3xl p-12">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={shiftData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis 
                dataKey="time" 
                stroke="#27272a" 
                tick={false}
                tickLine={false}
                hide
              />              

              <YAxis 
                stroke="#71717a" 
                tick={false}
                tickLine={false}
                hide
              />              

              {/* Running Time - Green */}
              <Area 
                type="monotone" 
                dataKey="running" 
                stackId="1" 
                stroke="#22c55e" 
                fill="#22c55e" 
                fillOpacity={0.75}
                name="Running"
              />

              {/* Stop Time - Red */}
              <Area 
                type="monotone" 
                dataKey="stopped" 
                stackId="1" 
                stroke="#ef4444" 
                fill="#ef4444" 
                fillOpacity={0.75}
                name="Stopped"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>  

        <div className="mt-6 text-white font-bold text-8xl flex justify-between">
          <span>{firstLabel}</span>
          <span>{endLabel}</span>
        </div>      
      </div>
    </div>
  );
}