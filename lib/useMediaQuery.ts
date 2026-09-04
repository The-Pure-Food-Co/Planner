'use client'
import { useCallback, useSyncExternalStore } from 'react'

/**
 * Subscribe to a CSS media query. SSR-safe: renders `false` on the server and
 * during hydration, then snaps to the real value on the client.
 *
 * Breakpoints below mirror the ones in app/globals.css — keep them in sync so
 * JS-driven layout switches (Gantt sidebar width, Board column width, My work
 * grid) flip at the same width as the CSS rules.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined') return () => {}
      const mq = window.matchMedia(query)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    },
    [query],
  )
  const getSnapshot = () =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

/** Phones and small tablets in portrait (matches the CSS `max-width: 767px` block). */
export const MOBILE_QUERY = '(max-width: 767px)'
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY)
}

/** Touch-first devices with no hover (matches the CSS `(hover: none) and (pointer: coarse)` block). */
export const COARSE_POINTER_QUERY = '(hover: none) and (pointer: coarse)'
export function useIsCoarsePointer(): boolean {
  return useMediaQuery(COARSE_POINTER_QUERY)
}
