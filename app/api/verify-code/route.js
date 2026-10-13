// Old email approvals remain valid, but public code redemption is retired.
export async function POST() {
  return Response.json({ error: 'Invitation codes are no longer needed. Open your invitation email or sign in to your approved account.' }, { status: 410 });
}
