import { redirect } from 'next/navigation';

export default function LegacyApproveRedirect() {
  redirect('/approvals');
}
