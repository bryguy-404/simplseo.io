import { cn } from '@/lib/utils';

// The app's loading mark: three dots hopping in a wave, after the green dot in
// the SimplSEO logo. The keyframes live in app/globals.css.
//
// <BrandLoader />   Inline, sized like an icon (h-4 w-4 etc.). It takes the
//                   colour of the text around it, so it works inside buttons.
// <PageLoader />    A centred block for "this page or section is loading".

const dot = 'block aspect-square w-1/4 rounded-full bg-current animate-[brand-hop_1.05s_ease-in-out_infinite] motion-reduce:animate-[brand-fade_1.6s_ease-in-out_infinite]';

export default function BrandLoader({ className, tone = 'current', ...props }) {
  return (
    <span
      aria-hidden="true"
      {...props}
      className={cn('inline-flex h-[1em] w-[1em] shrink-0 items-center justify-between', tone === 'brand' && 'text-[#00bf63]', className)}
    >
      <i className={dot} />
      <i className={dot} style={{ animationDelay: '0.14s' }} />
      <i className={dot} style={{ animationDelay: '0.28s' }} />
    </span>
  );
}

export function PageLoader({ label = 'Loading…', className, compact = false }) {
  return (
    <div role="status" className={cn('flex flex-col items-center justify-center gap-4 text-center text-sm text-muted-foreground', compact ? 'min-h-40 py-8' : 'min-h-[50vh] px-6 py-16', className)}>
      <BrandLoader tone="brand" className={compact ? 'h-7 w-7' : 'h-10 w-10'} />
      <p>{label}</p>
    </div>
  );
}
