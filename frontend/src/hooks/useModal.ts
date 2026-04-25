"use client";

import { useCallback, useMemo, useState } from "react";

export interface UseModalOptions {
  defaultOpen?: boolean;
}

export function useModal(options: UseModalOptions = {}) {
  const { defaultOpen = false } = options;
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  return useMemo(
    () => ({
      isOpen,
      setIsOpen,
      open,
      close,
      toggle,
    }),
    [isOpen, open, close, toggle]
  );
}

export type UseModalReturn = ReturnType<typeof useModal>;
