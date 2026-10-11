"use client";

import MentorWorkspace from './mentor/MentorWorkspace';

// Both entry points share the server-owned conversation and evidence service.
// Legacy client metric props are deliberately ignored.
export default function ChatAssistant({ onClose }) {
  return <MentorWorkspace compact onClose={onClose} />;
}
