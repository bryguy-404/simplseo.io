"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/app/contexts/ThemeContext";

export default function MarketingThemeToggle() {
  const { isDarkMode, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
      className="fixed bottom-6 right-6 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background/80 text-foreground shadow-lg backdrop-blur-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
    >
      {isDarkMode ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </button>
  );
}
