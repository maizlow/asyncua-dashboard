import { useEffect, useState } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { DashboardScreen } from "@/screens/DashboardScreen";
import { AlarmScreen } from "@/screens/AlarmScreen";

export function ScreenManager() {
  const [currentScreen, setCurrentScreen] = useState<number>(1);
  const lastMessage = useWebSocket();

  // React to screen change messages
  useEffect(() => {
    if (lastMessage?.type === "screen_change" && typeof lastMessage.screen === "number") {
      console.log("📺 Screen changed to:", lastMessage.screen);
      setCurrentScreen(lastMessage.screen);
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