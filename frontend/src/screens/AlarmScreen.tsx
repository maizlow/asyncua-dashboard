import { useEffect } from "react";
import { useAlarmStore } from "@/stores/useAlarmStore";
import { useWebSocket } from "@/hooks/useWebSocket";

export function AlarmScreen() {
  const { alarms, setAlarms, addAlarm, removeAlarm } = useAlarmStore();
  const lastMessage = useWebSocket();

  // Fetch current alarms when screen mounts
  useEffect(() => {
    const fetchAlarms = async () => {
      try {
        const res = await fetch("/api/alarms");
        const data = await res.json();
        if (data.alarms) {
          setAlarms(data.alarms);
        }
      } catch (err) {
        console.error("Failed to fetch alarms", err);
      }
    };

    fetchAlarms();
  }, [setAlarms]);

  // Listen to live WebSocket updates
  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === "alarm_added" && lastMessage.alarm) {
      addAlarm(lastMessage.alarm);
    }

    if (lastMessage.type === "alarm_removed" && lastMessage.alarm_id) {
      removeAlarm(lastMessage.alarm_id);
    }
  }, [lastMessage, addAlarm, removeAlarm]);

  return (
    <div
      className={`flex-1 overflow-hidden transition-all duration-300 ${
        alarms.length !== 0
          ? "border-64 animate-alarm-pulse"
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