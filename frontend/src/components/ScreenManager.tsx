import { useEffect, useState } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { DashboardScreen } from "@/screens/DashboardScreen";
import { AlarmScreen } from "@/screens/AlarmScreen";
import { ShiftPatternScreen } from "@/screens/ShiftPatternScreen";

export function ScreenManager() {
  const [currentScreen, setCurrentScreen] = useState<number>(1);
  const { lastMessage } = useWebSocket();   // ← Destructure correctly

  // Initial screen load
  useEffect(() => {
    fetch("/api/general")
      .then((res) => res.json())
      .then((data) => {
        if (data.ActiveScreenNr !== undefined) {
          setCurrentScreen(data.ActiveScreenNr);
        }
      })
      .catch(console.error);
  }, []);

  // Listen for screen change messages
  useEffect(() => {
    if (lastMessage?.type === "screen_change" && typeof lastMessage.screen === "number") {
      const newScreen = lastMessage.screen;
      console.log("📺 Switching to screen:", newScreen);

      setCurrentScreen(newScreen);

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
    switch (currentScreen) {
      case 1: return <AlarmScreen />;
      case 2: return <DashboardScreen />;
      case 3: return <ShiftPatternScreen />;
      default: return <DashboardScreen />;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {renderCurrentScreen()}
    </div>
  );
}