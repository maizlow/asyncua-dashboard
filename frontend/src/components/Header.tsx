import { useEffect, useState } from "react";

export function Header() {
  const [time, setTime] = useState(new Date());

  // Live updating clock
  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000); // Update every second

    return () => clearInterval(timer);
  }, []);

  // Format time nicely (large display)
  const formattedTime = time.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const formattedDate = time.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <header className="w-full bg-zinc-950 border-b-4 border-zinc-800 px-8 py-6">
      <div className="flex items-center justify-between max-w-full mx-20">
        
        {/* LEFT: Customer Logo */}
        <div className="flex items-center justify-start flex-1">
          <img
            src="/customerLogo.png"
            alt="Customer Logo"
            className="h-48 w-auto object-contain"
          />
        </div>

        {/* MIDDLE: Clock */}
        <div className="flex flex-col items-center">
          <div className="text-[150px] font-mono font-semibold tracking-[4px] text-white leading-none">
            {formattedTime}
          </div>
          <div className="text-6xl text-zinc-400 mt-1 tracking-wide uppercase">
            {formattedDate}
          </div>
        </div>

        {/* RIGHT: ABECE Logo */}
        <div className="flex items-center justify-end flex-1">
          <img
            src="/abeceLogo.svg"
            alt="ABECE Logo"
            className="h-48 w-auto object-contain brightness-0 invert"
          />
        </div>
      </div>
    </header>
  );
}