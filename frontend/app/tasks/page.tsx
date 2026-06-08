import { ModulePage } from '@/components/ModulePage';
import { configs } from '@/lib/config';

export default function Page() {
  return <ModulePage config={configs['tasks']} />;
}
