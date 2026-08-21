"use client";

import { useEffect, useState } from "react";

/**
 * Vue quasi temps réel. L'agent dépose une image dans Drive à intervalle
 * régulier ; on la recharge ici avec un paramètre anti-cache.
 */
export function LiveView({ refreshSec = 5 }: { refreshSec?: number }) {
  const [tick, setTick] = useState(() => 0);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), refreshSec * 1000);
    return () => clearInterval(timer);
  }, [refreshSec]);

  return (
    <div className="live">
      {broken ? (
        <div className="empty">
          Pas d’image disponible.
          <br />
          L’agent local n’a encore rien publié.
        </div>
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/live?t=${tick}`}
            alt="Vue de la caméra"
            onError={() => setBroken(true)}
            onLoad={() => setBroken(false)}
          />
          <span className="badge">
            <span className="led" />
            DIRECT · {refreshSec}s
          </span>
        </>
      )}
    </div>
  );
}
