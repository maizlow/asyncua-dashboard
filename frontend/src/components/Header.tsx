import { IS_DEMO } from "@/data/dataSource";
import type { LogoAsset } from "@/layout/layout";
import { useLayoutStore } from "@/stores/useLayoutStore";
import { useEffect, useState } from "react";

// The demo build (public GitHub Pages preview) must not show the real customer logo.
const CUSTOMER_LOGO =
  import.meta.env.VITE_DEMO === "true"
    ? `${import.meta.env.BASE_URL}demoLogo.svg`
    : `${import.meta.env.BASE_URL}customerLogo.png`;

// 24-hour Swedish clock, e.g. "17:27:31". No date line: too small to read from the floor.
const timeFmt = new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function Clock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  // Cap height >= 62 px @1080p -> comfortable at ~8 m on a 65" TV
  return (
    <div className="text-[200px] font-mono font-semibold tracking-[4px] text-white leading-none tabular-nums whitespace-nowrap">
      {timeFmt.format(time)}
    </div>
  );
}

function Logo({ asset }: { asset: LogoAsset }) {
  if (asset === "vendor")
    return <img src={`${import.meta.env.BASE_URL}abeceLogo.svg`} alt="ABECE Logo" className="h-48 w-auto object-contain brightness-0 invert" />;
  if (asset === "customer") return <img src={CUSTOMER_LOGO} alt="Customer Logo" className="h-48 w-auto object-contain" />;
  return null;
}

/**
 * Header area above the grid, kept while the screens change: a logo on each side (per display in the
 * layout document, or none) and the clock in the middle. Fixed height (the clock, 200 px) so the grid
 * below is the same size whatever the logos are.
 */
export function Header({ header }: { header?: { left: LogoAsset; right: LogoAsset } }) {
  const fromLayout = useLayoutStore((s) => s.layout?.display.header);
  // Until the layout has loaded: today's header (the default of every display)
  const { left, right } = header ?? fromLayout ?? { left: "customer", right: "vendor" };

  return (
    <header data-fit className="w-full bg-zinc-950 border-b-4 border-zinc-800 px-8 py-6">
      <div className="flex items-center justify-between max-w-full mx-20 h-[200px]">
        <div className="flex items-center justify-start flex-1 min-w-0">
          <Logo asset={left} />
        </div>

        <div className="flex items-center justify-center min-w-0">
          <Clock />
        </div>

        <div className="flex items-center justify-end flex-1 gap-16 min-w-0">
          {IS_DEMO && (
            <div className="rounded-full bg-amber-500/90 px-10 py-4 text-5xl font-semibold text-black whitespace-nowrap">
              DEMO · simulerad data
            </div>
          )}
          <Logo asset={right} />
        </div>
      </div>
    </header>
  );
}
