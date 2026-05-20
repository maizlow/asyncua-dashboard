import { Header } from "@/components/Header";
import { ScreenManager } from "@/components/ScreenManager";

function App() {
  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white">
      <Header />
      <ScreenManager />
    </div>
  );
}

export default App;