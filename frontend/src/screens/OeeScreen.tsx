import { BreakdownElement, KpiElement, ProgressElement } from "@/charts/Elements";
import { OEE_SCREEN as E } from "@/charts/presets";

// The OEE screen (type: oee), laid out for the 3840x2160 canvas (see ScaledCanvas) and read from
// 8-10 m on a 65" TV. Composed of the same chart elements an editor grid screen can use
// (src/charts, docs/examples/oee-element.yaml rebuilds it): OEE with A/P/Q, production vs target,
// and four KPI tiles (speed, scrap, stops, shift left). Hero values 290 px mono, key values 220 px,
// labels >= 104 px. Status is never colour-only: ▼/▲ and words such as "UNDER MÅL".
export function OeeScreen() {
  return (
    <div data-fit className="h-full min-h-0 grid grid-rows-[2fr_1fr] gap-12 px-16 pt-12 pb-14 overflow-hidden">
      {/* Row 1: OEE breakdown + production vs target */}
      <div className="grid grid-cols-[11fr_13fr] gap-12 min-h-0">
        <BreakdownElement item={E.breakdown} />
        <ProgressElement item={E.progress} />
      </div>

      {/* Row 2: speed, scrap, stops, shift */}
      <div className="grid grid-cols-4 gap-12 min-h-0">
        <KpiElement item={E.speed} />
        <KpiElement item={E.scrap} />
        <KpiElement item={E.stops} />
        <KpiElement item={E.remaining} />
      </div>
    </div>
  );
}
