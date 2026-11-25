"use client";

import { Button } from "@/components/ui/button";
import { useTheme } from "@/app/contexts/ThemeContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { trackAnalyticsEvent } from '@/app/lib/analytics';

const Navbar = ({ links, actionLabel = "Get started" }) => {
  const { isDarkMode } = useTheme();
  const router = useRouter();
  
  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `
        @media (max-width: 767px) {
          .marketing-nav {
            width: calc(100% - 24px);
            max-width: 420px;
          }
          .marketing-nav .navbar-brand {
            flex: 1;
            min-width: 0;
            padding-inline: 4px;
          }
          .navbar-logo-force {
            width: 100% !important;
            min-width: 0 !important;
            max-width: 130px !important;
            height: auto !important;
          }
          .marketing-nav .navbar-action {
            flex-shrink: 0;
            padding-inline: 10px;
            font-size: 12px;
          }
        }
        @media (min-width: 768px) {
          .navbar-logo-force {
            width: 130px !important;
            height: auto !important;
          }
        }
      `}} />
      <nav aria-label="Main navigation" className="floating-nav marketing-nav flex items-center gap-1">
        <Link href="/home" aria-label="SimplSEO home" className="navbar-brand flex shrink-0 items-center gap-2 px-1 sm:px-4">
          <img
            src={isDarkMode ? "/dark.png" : "/light.png"}
            alt="SimplSEO Logo"
            className="shrink-0 rounded-md navbar-logo-force"
            style={{ width: '250px', height: 'auto' }}
          />
        </Link>
      
      <div className="hidden md:flex items-center gap-1">
        {links ? links.map(link => (
          <a key={link.href} href={link.href} className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors rounded-full hover:bg-muted whitespace-nowrap">
            {link.label}
          </a>
        )) : <>
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
        </>}
      </div>
      <Button className="navbar-action" variant="ghost" size="sm" onClick={() => router.push('/auth')}>Sign in</Button>
      <Button 
        className="navbar-action rounded-full px-3 sm:px-6"
        size="sm"
        onClick={() => { trackAnalyticsEvent('early_access_click'); router.push('/request-access'); }}
      >
        {actionLabel}
      </Button>
    </nav>
    </>
  );
};

export default Navbar;

