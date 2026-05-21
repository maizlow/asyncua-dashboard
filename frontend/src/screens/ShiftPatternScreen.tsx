import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, CartesianGrid } from 'recharts';

// Fictional 12-hour shift data (06:00 – 18:00)
const shiftData = [
  { time: "06:00", running: 48, stopped: 12 },
  { time: "07:00", running: 52, stopped: 8 },
  { time: "08:00", running: 55, stopped: 5 },
  { time: "09:00", running: 58, stopped: 2 },
  { time: "10:00", running: 57, stopped: 3 },
  { time: "11:00", running: 59, stopped: 1 },
  { time: "12:00", running: 50, stopped: 10 },
  { time: "13:00", running: 45, stopped: 15 },
  { time: "14:00", },
  { time: "15:00", },
  { time: "16:00", },
  { time: "17:00",  },
  { time: "18:00",  },
];

export function ShiftPatternScreen() {
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