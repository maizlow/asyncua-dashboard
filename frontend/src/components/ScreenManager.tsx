import { useEffect, useState } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { DashboardScreen } from "@/screens/DashboardScreen";
import { AlarmScreen } from "@/screens/AlarmScreen";

export function ScreenManager() {
  const [currentScreen, setCurrentScreen] = useState<number>(1);
  const lastMessage = useWebSocket();

  useEffect(() => {
    fetch("/api/general")
      .then((res) => res.json())
      .then((data) => {
        console.log("📊 Initial screen from backend:", data.ActiveScreenNr);
        setCurrentScreen(data.ActiveScreenNr);
      });

    if (lastMessage?.type === "screen_change" && typeof lastMessage.screen === "number") {
      const newScreen = lastMessage.screen;
      console.log("📺 Switching to screen:", newScreen);

      setCurrentScreen(newScreen);
      // === Confirm to backend that we switched ===
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
      case 1:
        return <AlarmScreen />;
      case 2:
        return <DashboardScreen />;
      default:
        return <DashboardScreen />;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {renderCurrentScreen()}
    </div>
  );
}