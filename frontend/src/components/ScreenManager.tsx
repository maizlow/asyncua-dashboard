import { useCallback, useEffect, useRef, useState } from "react";
import { dataSource } from "@/data/dataSource";
import { useServerMessages } from "@/hooks/useWebSocket";
import { useMetricsStore } from "@/stores/useMetricsStore";
import { DashboardScreen } from "@/screens/DashboardScreen";
import { AlarmScreen } from "@/screens/AlarmScreen";
import { ShiftPatternScreen } from "@/screens/ShiftPatternScreen";
import { OeeScreen } from "@/screens/OeeScreen";

const FADE_OUT_MS = 2000;

/**
 * Shows the screen selected by the PLC: 1 = Larm, 2 = Dashboard, 3 = Skiftmönster, 4 = OEE. Display-only: the frontend never writes
 * anything back; the backend acknowledges screen changes (ActiveScreenNr) itself.
 */
export function ScreenManager() {
  const [visibleScreen, setVisibleScreen] = useState<number>(1);
  const [isLoadingScreenData, setIsLoadingScreenData] = useState(false);
  const [screenOpacity, setScreenOpacity] = useState(1);
  // Incremented on every switch so an older, still-running switch can't override a newer one
  const switchSeq = useRef(0);

  // Switch screens with a fade, prefetching data while the screen is faded out
  const switchToScreen = useCallback(async (newScreen: number) => {
    const seq = ++switchSeq.current;

    // 1. Fade out current content
    setScreenOpacity(0);
    await new Promise((resolve) => setTimeout(resolve, FADE_OUT_MS));
    if (seq !== switchSeq.current) return;

    // 2. Do all data fetching / side effects while the screen is faded out
    if (newScreen === 3) {
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
    } else if (newScreen === 4) {
      try {
        const details = await dataSource.getOeeDetails();
        if (details) useMetricsStore.getState().setOeeDetails(details);
      } catch (e) {
        console.error("Failed to fetch OEE details:", e);
      }
      if (seq !== switchSeq.current) return;
    } else if (newScreen === 2) {
      // Ask for a fresh snapshot for a better Dashboard experience (non-blocking, read-only)
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
    if (isLoadingScreenData) {
      return (
        <div className="flex items-center justify-center h-full text-8xl text-zinc-400">
          Laddar...
        </div>
      );
    }

    switch (visibleScreen) {
      case 1:
        return <AlarmScreen />;
      case 2:
        return <DashboardScreen />;
      case 3:
        return <ShiftPatternScreen />;
      case 4:
        return <OeeScreen />;
      default:
        return <DashboardScreen />;
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
