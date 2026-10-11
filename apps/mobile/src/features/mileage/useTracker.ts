import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';

import { addFix, type Fix, toKm } from './distance';

export type TrackerState = 'idle' | 'tracking' | 'denied' | 'error';

/** Measures a drive while the screen is open: start, then stop to get the km. */
export function useTracker() {
  const [state, setState] = useState<TrackerState>('idle');
  const [metres, setMetres] = useState(0);
  const sub = useRef<Location.LocationSubscription | null>(null);
  const acc = useRef<{ metres: number; last: Fix | null }>({ metres: 0, last: null });

  const stopWatching = () => {
    sub.current?.remove();
    sub.current = null;
  };
  useEffect(() => stopWatching, []);

  const start = async () => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setState('denied');
        return;
      }
      acc.current = { metres: 0, last: null };
      setMetres(0);
      setState('tracking');
      sub.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 20, timeInterval: 5000 },
        ({ coords }) => {
          acc.current = addFix(acc.current, coords);
          setMetres(acc.current.metres);
        },
      );
    } catch {
      setState('error');
    }
  };

  /** Ends the drive and returns its length in km. */
  const stop = (): string => {
    stopWatching();
    setState('idle');
    return toKm(acc.current.metres);
  };

  return { state, km: toKm(metres), start, stop };
}
