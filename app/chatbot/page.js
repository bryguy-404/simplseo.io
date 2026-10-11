"use client";

import MainLayout from '../components/MainLayout';
import MentorWorkspace from '../components/mentor/MentorWorkspace';

export default function Chatbot() {
  return <MainLayout showChat={false}>
    <div className="mx-auto w-full max-w-7xl px-3 sm:px-6 py-4"><MentorWorkspace /></div>
  </MainLayout>;
}
