import { Header } from "@/components/Header";
import { ScreenManager } from "@/components/ScreenManager";
import { useWebSocket } from "@/hooks/useWebSocket";

function App() {
  const { status } = useWebSocket();

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white">
      <Header />

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