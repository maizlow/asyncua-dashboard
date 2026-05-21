import { useEffect, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useWebSocket } from "@/hooks/useWebSocket";

// Fictional fallback data (used until real data arrives)
const fallbackData: Array<{ time: string; running: number; stopped: number }> = [];

export function ShiftPatternScreen() {
  const [shiftData, setShiftData] = useState(fallbackData);
  const { lastMessage } = useWebSocket();

  useEffect(() => {
    if (lastMessage?.type === "shift_pattern_data" && Array.isArray(lastMessage.data)) {
      console.log("📊 Received live shift pattern data");
      setShiftData(lastMessage.data);
      console.log(shiftData);
    }
  }, [lastMessage]);

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white overflow-hidden">
      <div className="flex-1 flex flex-col p-8">
        <div className="mb-6">
          <h1 className="text-9xl font-bold tracking-tight">Shift Pattern Analysis</h1>
          <p className="text-6xl text-zinc-400 mt-2">Running vs Stop Time – 12 Hour Shift</p>
        </div>

        {/* Chart takes up the rest of the space */}
        <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-3xl p-12">
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
          <span>06:00</span>
          <span>18:00</span>
        </div>      
      </div>
    </div>
  );
}