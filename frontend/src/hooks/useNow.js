import { useEffect, useState } from "react";

/** Current time, ticking every second while a timer runs and every minute
 *  otherwise (so "today" still rolls over at midnight). */
export function useNow(fast) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), fast ? 1000 : 60_000);
    return () => clearInterval(id);
  }, [fast]);
  return now;
}
