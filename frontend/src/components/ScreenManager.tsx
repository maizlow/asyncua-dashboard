import { useCallback, useEffect, useRef, useState } from "react";
import { dataSource } from "@/data/dataSource";
import { useServerMessages } from "@/hooks/useWebSocket";
import { useMetricsStore } from "@/stores/useMetricsStore";
import { useLayoutStore } from "@/stores/useLayoutStore";
import { LayoutError } from "@/data/types";
import type { Layout, ScreenConfig } from "@/layout/layout";
import { GridScreen } from "@/screens/GridScreen";
import { AlarmScreen } from "@/screens/AlarmScreen";
import { ShiftPatternScreen } from "@/screens/ShiftPatternScreen";
import { OeeScreen } from "@/screens/OeeScreen";
import { WeekScreen } from "@/screens/WeekScreen";
import { HighscoreScreen } from "@/screens/HighscoreScreen";

const FADE_OUT_MS = 2000;

const LAYOUT_RETRY_MS = 5000;

/** Screen number -> config; unknown numbers fall back to the first grid screen (else the first screen). */
function resolveScreen(layout: Layout, nr: number): ScreenConfig | undefined {
  return (
    layout.screens.find((s) => s.nr === nr) ??
    layout.screens.find((s) => s.type === "grid") ??
    layout.screens[0]
  );
}

/**
 * Shows the screen selected by the PLC (ActiveScreenNr); what each number shows comes from
 * dashboard.yaml (default: 1 = Larm, 2 = Dashboard, 3 = Skiftmönster, 4 = OEE, 5 = 7 dagar, 6 = Highscore). Display-only: the
 * frontend never writes anything back; the backend acknowledges screen changes itself.
 */
export function ScreenManager() {
  const layout = useLayoutStore((s) => s.layout);
  const layoutError = useLayoutStore((s) => s.error);
  const [visibleScreen, setVisibleScreen] = useState<number>(1);
  const [isLoadingScreenData, setIsLoadingScreenData] = useState(false);
  const [screenOpacity, setScreenOpacity] = useState(1);
  // Incremented on every switch so an older, still-running switch can't override a newer one
  const switchSeq = useRef(0);

  // (Re)load the layout on every (re)connect: a changed dashboard.yaml only needs a backend restart
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      dataSource
        .getLayout()
        .then((l) => !cancelled && useLayoutStore.getState().setLayout(l))
        .catch((e) => {
          if (cancelled) return;
          if (e instanceof LayoutError) useLayoutStore.getState().setError(e.details);
          else console.error("Failed to load layout:", e);
          timer = setTimeout(load, LAYOUT_RETRY_MS);
        });
    };
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Switch screens with a fade, prefetching data while the screen is faded out
  const switchToScreen = useCallback(async (newScreen: number) => {
    const seq = ++switchSeq.current;
    const current = useLayoutStore.getState().layout;
    const type = current ? resolveScreen(current, newScreen)?.type : undefined;

    // 1. Fade out current content
    setScreenOpacity(0);
    await new Promise((resolve) => setTimeout(resolve, FADE_OUT_MS));
    if (seq !== switchSeq.current) return;

    // 2. Do all data fetching / side effects while the screen is faded out
    if (type === "shift") {
      setIsLoadingScreenData(true);
      try {
        const rows = await dataSource.getShiftPattern();
        if (rows) useMetricsStore.getState().setShiftPattern(rows);
      } catch (e) {
        console.error("Failed to fetch shift pattern:", e);
      } finally {
        setIsLoadingScreenData(false);
      }
      if (seq !== switchSeq.current) return;
    } else if (type === "oee") {
      try {
        const details = await dataSource.getOeeDetails();
        if (details) useMetricsStore.getState().setOeeDetails(details);
      } catch (e) {
        console.error("Failed to fetch OEE details:", e);
      }
      if (seq !== switchSeq.current) return;
    } else if (type === "week") {
      try {
        const history = await dataSource.getDailyHistory();
        if (history) useMetricsStore.getState().setDailyHistory(history);
      } catch (e) {
        console.error("Failed to fetch daily history:", e);
      }
      if (seq !== switchSeq.current) return;
    } else if (type === "highscore") {
      try {
        const scores = await dataSource.getHighscores();
        if (scores) useMetricsStore.getState().setHighscores(scores);
      } catch (e) {
        console.error("Failed to fetch highscores:", e);
      }
      if (seq !== switchSeq.current) return;
    } else if (type === "grid") {
      // Ask for a fresh snapshot for a better grid screen experience (non-blocking, read-only)
      dataSource.requestSnapshot();
    }

    // 3. Show the new screen
    setVisibleScreen(newScreen);

    // 4. Small delay then fade the new content back in
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (seq !== switchSeq.current) return;
    setScreenOpacity(1);
  }, []);

  // Initial screen load
  useEffect(() => {
    dataSource
      .getActiveScreen()
      .then((screen) => {
        if (screen !== undefined) return switchToScreen(screen);
      })
      .catch(console.error);
  }, [switchToScreen]);

  // Screen change requested by the PLC (pushed by the backend)
  useServerMessages((msg) => {
    if (msg.type === "screen_change" && typeof msg.screen === "number") {
      console.log("📺 Switching to screen:", msg.screen);
      void switchToScreen(msg.screen);
    }
  });

  const renderCurrentScreen = () => {
    if (layoutError && !layout) {
      return (
        <div data-fit className="h-full min-h-0 overflow-hidden px-16 py-12 flex flex-col gap-10">
          <div className="text-[140px] font-bold text-[var(--accent-red)] tv-truncate">⚠ Fel i dashboard.yaml</div>
          {layoutError.slice(0, 5).map((line) => (
            <div key={line} className="text-[104px] font-mono text-zinc-200 tv-truncate">
              {line}
            </div>
          ))}
        </div>
      );
    }
    if (!layout || isLoadingScreenData) {
      return (
        <div className="flex items-center justify-center h-full text-8xl text-zinc-400">
          Laddar...
        </div>
      );
    }

    const screen = resolveScreen(layout, visibleScreen);
    switch (screen?.type) {
      case "alarms":
        return <AlarmScreen />;
      case "shift":
        return <ShiftPatternScreen />;
      case "oee":
        return <OeeScreen />;
      case "week":
        return <WeekScreen />;
      case "highscore":
        return <HighscoreScreen />;
      case "grid":
        return <GridScreen key={screen.nr} screen={screen} />;
      default:
        return null;
    }
  };

  return (
    <div data-fit className="flex flex-col flex-1 min-h-0">
      <div
        className="transition-opacity duration-3000 ease-in-out h-full min-h-0"
        style={{ opacity: screenOpacity }}
      >
        {renderCurrentScreen()}
      </div>
    </div>
  );
}
