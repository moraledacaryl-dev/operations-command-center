'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { DEPARTMENT_CHANGE_EVENT, getCurrentDepartmentId, getStoredUser } from './session';

export function useActiveDepartment() {
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const sync = () => {
      setDepartmentId(getCurrentDepartmentId(getStoredUser()));
      setHydrated(true);
    };
    sync();
    window.addEventListener(DEPARTMENT_CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(DEPARTMENT_CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return { departmentId, hydrated };
}

export function useCreateIntent(onCreate: () => void) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const create = searchParams.get('create');

  useEffect(() => {
    if (create !== '1') return;
    onCreate();
    const next = new URLSearchParams(searchParams.toString());
    next.delete('create');
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [create, onCreate, pathname, router, searchParams]);
}

export function useLatestRequest() {
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  return useCallback(() => {
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    const currentGeneration = ++generation.current;
    return {
      signal: nextController.signal,
      isCurrent: () => generation.current === currentGeneration && !nextController.signal.aborted,
    };
  }, []);
}
