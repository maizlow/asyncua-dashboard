import { Header } from "@/components/Header";
import { ScaledCanvas } from "@/components/ScaledCanvas";
import { ScreenManager } from "@/components/ScreenManager";
import { useConnectionStatus } from "@/hooks/useWebSocket";
import { useDataFeed } from "@/hooks/useDataFeed";

function App() {
  const status = useConnectionStatus();
  useDataFeed();

  return (
    <ScaledCanvas>
      <div className="relative flex flex-col h-full bg-zinc-950 text-white">
        <Header />

        {/* Connection Status Banner */}
        {status === "disconnected" && (
          <div className="bg-red-600 text-white text-center py-15 text-8xl font-medium">
            ⚠️ Anslutningen bröts – väntar på att återansluta...
          </div>
        )}
        {status === "connecting" && (
          <div className="bg-red-600 text-white text-center py-15 text-8xl font-medium">
            ⚠️ Anslutningen bröts – återansluter...
          </div>
        )}
        {status === "connected" && <ScreenManager />}
      </div>
    </ScaledCanvas>
  );
}

export default App;
