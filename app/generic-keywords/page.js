"use client";

import { Suspense } from 'react';
import NewPageWorkspace from '../components/new-pages/NewPageWorkspace';
import MainLayout from '../components/MainLayout';

export default function GenericKeywordsPage() {
  return <MainLayout><Suspense fallback={<p role="status" className="p-8">Loading your saved page ideas…</p>}><NewPageWorkspace /></Suspense></MainLayout>;
}
