import { useEffect, useState } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { DashboardScreen } from "@/screens/DashboardScreen";
import { AlarmScreen } from "@/screens/AlarmScreen";
import { ShiftPatternScreen } from "@/screens/ShiftPatternScreen";

export function ScreenManager() {
  const [currentScreen, setCurrentScreen] = useState<number>(1);
  const [visibleScreen, setVisibleScreen] = useState<number>(1);
  const [shiftPatternData, setShiftPatternData] = useState<any[] | null>(null);
  const [isLoadingScreenData, setIsLoadingScreenData] = useState(false);
  const [screenOpacity, setScreenOpacity] = useState(1);
  const { lastMessage } = useWebSocket();   // ← Destructure correctly

    // Helper to switch screens with best UX (prefetch data when needed) + reliable fade
    const switchToScreen = async (newScreen: number) => {
      // 1. Fade out current content
      setScreenOpacity(0);
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 2. Do all data fetching / side effects while the screen is faded out
      if (newScreen === 3) {
        setIsLoadingScreenData(true);
        try {
          const res = await fetch("/api/shift-pattern");
          const json = await res.json();
          if (json.data) {
            setShiftPatternData(json.data);
          }
        } catch (e) {
          console.error("Failed to fetch shift pattern:", e);
        } finally {
          setIsLoadingScreenData(false);
        }
      } else if (newScreen === 2) {
        // Trigger a fresh snapshot for better Dashboard experience (non-blocking)
        fetch("/api/snapshot", { method: "POST" }).catch(() => {});
      }

      // 3. Update both the logical screen and the actually visible screen
      setCurrentScreen(newScreen);
      setVisibleScreen(newScreen);

      // 4. Small delay then fade the new content back in
      await new Promise(resolve => setTimeout(resolve, 30));
      setScreenOpacity(1);
    };

  // Initial screen load
  useEffect(() => {
    fetch("/api/general")
      .then((res) => res.json())
      .then(async (data) => {
        if (data.ActiveScreenNr !== undefined) {
          const initialScreen = data.ActiveScreenNr;
          await switchToScreen(initialScreen);
        }
      })
      .catch(console.error);
  }, []);

    // Listen for screen change messages
  useEffect(() => {
    if (lastMessage?.type === "screen_change" && typeof lastMessage.screen === "number") {
      const newScreen = lastMessage.screen;
      console.log("📺 Switching to screen:", newScreen);

      // Use our improved switch function (prefetches data when needed)
      switchToScreen(newScreen);

      // Confirm back to backend
      fetch("/api/general", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "ActiveScreenNr",
          value: newScreen
        })
      }).catch(console.error);
    }
  }, [lastMessage]);

        const renderCurrentScreen = () => {
    if (isLoadingScreenData) {
      return (
        <div className="flex items-center justify-center h-full text-4xl text-zinc-400">
          Loading...
        </div>
      );
    }

    switch (visibleScreen) {
      case 1:
        return <AlarmScreen />;
      case 2:
        return <DashboardScreen />;
      case 3:
        return <ShiftPatternScreen data={shiftPatternData ?? undefined} />;
      default:
        return <DashboardScreen />;
    }
  };

    return (
    <div className="flex flex-col h-full">
      <div
        className="transition-opacity duration-3000 ease-in-out h-full"
        style={{ opacity: screenOpacity }}
      >
        {renderCurrentScreen()}
      </div>
    </div>
  );
}