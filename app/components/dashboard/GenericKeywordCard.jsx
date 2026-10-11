"use client";

import Link from 'next/link';
import { Button } from '@/components/ui/button';

// Dashboard visits never generate paid opportunity suggestions.
export default function GenericKeywordCard() {
  return <div className="space-y-4 text-sm"><p className="text-muted-foreground">Choose an area you serve, review existing pages and see whether a new page would add something useful.</p><Button variant="outline" asChild><Link href="/generic-keywords">Find new page ideas</Link></Button></div>;
}
