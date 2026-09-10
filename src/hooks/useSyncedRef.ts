import { useRef, type MutableRefObject } from 'react';

/** Mirror a prop/state value into a ref so async callbacks read the latest value. */
export function useSyncedRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
