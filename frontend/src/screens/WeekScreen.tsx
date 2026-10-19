import { useMemo } from "react";
import { BarsElement } from "@/charts/Elements";
import { ChartDataContext, useChartData } from "@/charts/context";
import { WEEK_SCREEN } from "@/charts/presets";
import { useMetricsStore } from "@/stores/useMetricsStore";
import type { Aggregates } from "@/data/types";

// Today + the previous 6 days (screen type: week), laid out for the 3840x2160 canvas (see ScaledCanvas)
// and read from 8-10 m (cap heights at 1080p: OEE ≈ 53 px, counts ≈ 38 px, labels ≥ 37 px). The same
// bar chart element an editor grid screen can use (kind bars, docs/examples/7dagar-element.yaml), fed
// by the screen's own message daily_history: OEE % on top, a bar of good tiles per day with the day
// target as a white line, the good count and the day label below. Nothing scrolls.
export function WeekScreen() {
  const history = useMetricsStore((s) => s.dailyHistory);
  const base = useChartData();
  const data = useMemo(
    () => ({ ...base, aggregates: history ? ({ days: history.days, nominal_tpm: history.nominal_tpm, shifts: [] } as unknown as Aggregates) : null }),
    [base, history],
  );
  return (
    <div data-fit className="h-full min-h-0 flex flex-col px-16 pt-10 pb-14 overflow-hidden">
      <ChartDataContext.Provider value={data}>
        <BarsElement item={WEEK_SCREEN} />
      </ChartDataContext.Provider>
    </div>
  );
}
