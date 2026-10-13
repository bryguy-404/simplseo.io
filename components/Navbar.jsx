"use client";

import { Button } from "@/components/ui/button";
import { useTheme } from "@/app/contexts/ThemeContext";
import { useRouter } from "next/navigation";

const Navbar = () => {
  const { isDarkMode } = useTheme();
  const router = useRouter();
  
  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `
        @media (max-width: 767px) {
          .navbar-logo-force {
            width: clamp(100px, calc(100vw - 210px), 150px) !important;
            min-width: clamp(100px, calc(100vw - 210px), 150px) !important;
            max-width: none !important;
            height: auto !important;
          }
        }
        @media (min-width: 768px) {
          .navbar-logo-force {
            width: 200px !important;
            height: auto !important;
          }
        }
      `}} />
      <nav className="floating-nav flex items-center gap-1">
        <div className="flex items-center gap-2 px-1 sm:px-4">
          <img
            src={isDarkMode ? "./dark.png" : "./light.png"}
            alt="SimplSEO Logo"
            className="rounded-md navbar-logo-force"
            style={{ width: '250px', height: 'auto' }}
          />
        </div>
      
      <div className="hidden md:flex items-center gap-1">
        <button 
          onClick={() => {
            const el = document.getElementById('features');
            if (el) {
              const y = el.getBoundingClientRect().top + window.pageYOffset - 100;
              window.scrollTo({ top: y, behavior: 'smooth' });
            }
          }}
          className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors rounded-full hover:bg-muted"
        >
          Why?
        </button>
        <button 
          onClick={() => {
            const el = document.getElementById('stacking-cards');
            if (el) {
              const y = el.getBoundingClientRect().top + window.pageYOffset - 100;
              window.scrollTo({ top: y, behavior: 'smooth' });
            }
          }}
          className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors rounded-full hover:bg-muted"
        >
          Features
        </button>
        <button 
          onClick={() => {
            const el = document.getElementById('how-it-works');
            if (el) {
              const y = el.getBoundingClientRect().top + window.pageYOffset - 100;
              window.scrollTo({ top: y, behavior: 'smooth' });
            }
          }}
          className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors rounded-full hover:bg-muted"
        >
          How?
        </button>
        <button 
          onClick={() => {
            const el = document.getElementById('faq');
            if (el) {
              const y = el.getBoundingClientRect().top + window.pageYOffset - 100;
              window.scrollTo({ top: y, behavior: 'smooth' });
            }
          }}
          className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors rounded-full hover:bg-muted"
        >
          FAQ
        </button>
      </div>
      <Button variant="ghost" size="sm" onClick={() => router.push('/auth')}>Sign in</Button>
      <Button 
        className="rounded-full px-3 sm:px-6"
        size="sm"
        onClick={() => router.push('/request-access')}
      >
        Get started
      </Button>
    </nav>
    </>
  );
};

export default Navbar;

