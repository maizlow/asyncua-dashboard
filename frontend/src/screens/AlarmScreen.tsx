import { useEffect } from "react";
import { dataSource } from "@/data/dataSource";
import { useAlarmStore } from "@/stores/useAlarmStore";

export function AlarmScreen() {
  // Live alarm_added / alarm_removed messages are applied to the store by useDataFeed (App)
  const alarms = useAlarmStore((s) => s.alarms);
  const setAlarms = useAlarmStore((s) => s.setAlarms);

  // Fetch the authoritative list of active alarms when the screen mounts
  useEffect(() => {
    let cancelled = false;
    dataSource
      .getAlarms()
      .then((list) => {
        if (!cancelled) setAlarms(list);
      })
      .catch((err) => console.error("Failed to fetch alarms", err));
    return () => {
      cancelled = true;
    };
  }, [setAlarms]);

  return (
    <div
      className={`flex-1 overflow-hidden transition-all duration-300 ${
        alarms.length !== 0
          ? "border-42 animate-alarm-pulse"
          : ""
      }`}
    >
        <div className="p-8">
        {alarms.length === 0 ? (
            <div className="flex items-center justify-center h-[60vh]">
            <div className="text-9xl text-zinc-500">No active alarms</div>
            </div>
        ) : (
            <div className="space-y-4">
            {alarms.map((alarm) => (
                <div
                key={alarm.ID}
                className={`bg-zinc-900 rounded-2xl p-8 flex items-center justify-between border-l-32 ${
                            alarm.displayClass === 1 ? "border-red-600" : "border-yellow-500"
                            }`}
                >                
                <div className="flex-1">
                    <div className="text-[140px] font-semibold text-white mb-2 uppercase">
                    {alarm.message}
                    </div>
                    <div className="text-3xl text-zinc-400">
                    ID: {alarm.ID} &nbsp;&nbsp; Class: {alarm.displayClass}
                    </div>
                </div>
                </div>
            ))}
            </div>
        )}
        </div>
    </div>    
  );
}