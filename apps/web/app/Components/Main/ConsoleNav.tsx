"use client";

import { createContext, useContext } from "react";
import type { NavId } from "./navigation";

/** Lets console pages (e.g. dashboard tiles) switch the active console view. */
export const ConsoleNavContext = createContext<(page: NavId) => void>(() => {});

export function useConsoleNav() {
  return useContext(ConsoleNavContext);
}
