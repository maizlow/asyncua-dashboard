import { Header } from "@/components/Header";
import { ScreenManager } from "@/components/ScreenManager";
import { useConnectionStatus } from "@/hooks/useWebSocket";
import { useDataFeed } from "@/hooks/useDataFeed";
import { IS_DEMO } from "@/data/dataSource";

function App() {
  const status = useConnectionStatus();
  useDataFeed();

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white">
      <Header />

      {IS_DEMO && (
        <div className="fixed bottom-4 right-4 z-50 rounded-full bg-amber-500/90 px-6 py-2 text-2xl font-semibold text-black">
          DEMO · simulated data
        </div>
      )}

      {/* Connection Status Banner */}
      {status === "disconnected" && (
        <div className="bg-red-600 text-white text-center py-15 text-8xl font-medium">
          ⚠️ Connection lost — waiting to try and reconnect...
        </div>
      )}
      {status === "connecting" && (
        <div className="bg-red-600 text-white text-center py-15 text-8xl font-medium">
          ⚠️ Connection lost — reconnecting...
        </div>
      )}
      {status === "connected" && <ScreenManager />}      
    </div>
  );
}

export default App;