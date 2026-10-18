import { useEffect } from "react";
import { OctagonAlert, TriangleAlert } from "lucide-react";
import { dataSource } from "@/data/dataSource";
import { useAlarmStore } from "@/stores/useAlarmStore";
import type { Alarm } from "@/data/types";

// Laid out for the 3840x2160 canvas (see ScaledCanvas). Fixed rows: 3 alarms always fit, the
// rest are summarised in a fixed footer. Alarm text: 220 px (~78 px cap height at 1080p,
// comfortable at ~8 m on a 65" TV), clamped to 2 lines with an ellipsis.
const MAX_VISIBLE_ALARMS = 3;

function classInfo(alarm: Alarm) {
  // Class 1 = stopping alarm, everything else = warning. Colour + icon + word (not colour alone).
  return alarm.displayClass === 1
    ? { word: "LARM", color: "var(--accent-red)", border: "border-red-500", Icon: OctagonAlert }
    : { word: "VARNING", color: "var(--accent-amber)", border: "border-amber-400", Icon: TriangleAlert };
}

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

  // Stopping alarms first, then warnings (stable within each class)
  const sorted = [...alarms].sort((a, b) => (a.displayClass === 1 ? 0 : 1) - (b.displayClass === 1 ? 0 : 1));
  const hidden = Math.max(0, sorted.length - MAX_VISIBLE_ALARMS);

  return (
    <div
      data-fit
      className={`h-full min-h-0 overflow-hidden transition-all duration-300 ${
        alarms.length !== 0 ? "border-42 animate-alarm-pulse" : ""
      }`}
    >
      {alarms.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-[160px] text-zinc-300">Inga aktiva larm</div>
        </div>
      ) : (
        <div className="h-full min-h-0 flex flex-col p-6 gap-6 overflow-hidden">
          <div className="flex-1 min-h-0 grid grid-rows-3 gap-6">
            {sorted.slice(0, MAX_VISIBLE_ALARMS).map((alarm) => {
              const { word, color, border, Icon } = classInfo(alarm);
              return (
                <div
                  key={alarm.ID}
                  className={`bg-zinc-900 rounded-[40px] px-12 py-4 flex items-center gap-12 min-h-0 min-w-0 overflow-hidden border-l-32 ${border}`}
                >
                  <div className="w-[600px] shrink-0 flex flex-col items-center justify-center gap-4" style={{ color }}>
                    <Icon size={170} strokeWidth={2.25} aria-hidden />
                    <div className="text-[110px] font-bold leading-none tracking-wide">{word}</div>
                  </div>
                  <div className="flex-1 min-w-0 text-[220px] leading-[1.12] font-semibold text-white uppercase line-clamp-2 break-words">
                    {alarm.message}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="h-[110px] shrink-0 flex items-center px-4 min-w-0">
            <div className="text-[110px] text-zinc-300 tv-truncate">{hidden > 0 && `+ ${hidden} fler aktiva larm`}</div>
          </div>
        </div>
      )}
    </div>
  );
}
