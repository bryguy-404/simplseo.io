import Link from 'next/link';
export default function LegacyInvitation() {
  return <main className="mx-auto max-w-lg px-5 py-16 space-y-5"><h1 className="text-2xl font-semibold">You don’t need to enter a code</h1><p>If you received an earlier approval email, sign in with that approved email. New invitations have an Accept invitation button that takes you directly to setup.</p><Link className="block underline text-primary" href="/auth">Sign in</Link><Link className="block underline" href="/request-access">Request early access</Link></main>;
}
