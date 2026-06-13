"use client";

import { getGPUTier, type TierResult } from "detect-gpu";
import { useEffect, useState } from "react";

export function useGPUTier() {
  const [gpuTier, setGpuTier] = useState<TierResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    getGPUTier()
      .then((result) => {
        if (cancelled) return;

        setGpuTier(result);

        if (process.env.NODE_ENV === "development") {
          console.log("[detect-gpu] GPU tier result:", result);
        }
      })
      .catch((error) => {
        if (cancelled) return;

        if (process.env.NODE_ENV === "development") {
          console.error("[detect-gpu] Failed to detect GPU tier:", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return gpuTier;
}

export function isLowGpuTier(gpuTier: TierResult | null): boolean {
  return gpuTier !== null && gpuTier.tier <= 1;
}
