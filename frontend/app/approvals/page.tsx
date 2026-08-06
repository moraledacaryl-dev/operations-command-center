import { ModulePage } from '@/components/ModulePage';
import { configs } from '@/lib/config';

export default function ApprovalsPage() {
  return <ModulePage config={configs.approve} />;
}
