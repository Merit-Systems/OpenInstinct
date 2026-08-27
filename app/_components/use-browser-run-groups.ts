"use client";

import { useEffect, useState } from "react";
import {
  browserRunStoreEvent,
  readBrowserRunGroups,
  type BrowserRunGroup,
} from "@/app/_lib/browser-run-store";

export function useBrowserRunGroups() {
  const [groups, setGroups] = useState<readonly BrowserRunGroup[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const refresh = () => {
      setGroups(readBrowserRunGroups());
      setLoaded(true);
    };

    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener(browserRunStoreEvent, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(browserRunStoreEvent, refresh);
    };
  }, []);

  return { groups, loaded };
}
