import { useEffect } from "react";
import { dataSource } from "@/data/dataSource";
import { useAlarmStore } from "@/stores/useAlarmStore";

const MAX_VISIBLE_ALARMS = 4;

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
      className={`h-full min-h-0 overflow-hidden transition-all duration-300 ${
        alarms.length !== 0
          ? "border-42 animate-alarm-pulse"
          : ""
      }`}
    >
        <div className="p-8 h-full min-h-0 overflow-hidden">
        {alarms.length === 0 ? (
            <div className="flex items-center justify-center h-full">
            <div className="text-9xl text-zinc-500">Inga aktiva larm</div>
            </div>
        ) : (
            <div className="space-y-4">
            {/* At most 4 alarms fit the canvas; the rest are summarised below */}
            {alarms.slice(0, MAX_VISIBLE_ALARMS).map((alarm) => (
                <div
                key={alarm.ID}
                className={`bg-zinc-900 rounded-2xl p-8 flex items-center justify-between border-l-32 ${
                            alarm.displayClass === 1 ? "border-red-600" : "border-yellow-500"
                            }`}
                >                
                <div className="flex-1">
                    <div className="text-[140px] leading-tight font-semibold text-white mb-2 uppercase line-clamp-2 break-words">
                    {alarm.message}
                    </div>
                    <div className="text-5xl text-zinc-400">
                    ID: {alarm.ID} &nbsp;&nbsp; Klass: {alarm.displayClass}
                    </div>
                </div>
                </div>
            ))}
            {alarms.length > MAX_VISIBLE_ALARMS && (
                <div className="text-7xl text-zinc-400 pt-4">
                + {alarms.length - MAX_VISIBLE_ALARMS} fler aktiva larm
                </div>
            )}
            </div>
        )}
        </div>
    </div>    
  );
}