"use client";

import { useTheme } from "@/app/contexts/ThemeContext";
import Link from "next/link";

const Footer = () => {
  const { isDarkMode } = useTheme();
  
  return (
    <footer className="border-t border-border py-12 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <Link href="/home" aria-label="SimplSEO home" className="flex shrink-0 items-center gap-2">
            <img
              src={isDarkMode ? "/dark.png" : "/light.png"}
              alt="SimplSEO Logo"
              className="shrink-0 rounded-md"
              style={{ width: '150px', height: 'auto' }}
            />
          </Link>
          
          <div className="flex flex-wrap justify-center items-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
            <Link href="/seo-for-photographers" className="hover:text-foreground transition-colors">SEO for photographers</Link>
            <a href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</a>
          </div>
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} SimplSEO. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;

