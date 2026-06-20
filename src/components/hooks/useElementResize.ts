import { useEffect, useRef } from "react";

export default function useElementResize<T extends Element = Element>(
  callback: (element: T) => void,
  ref: React.RefObject<T>
) {
  // Guard de reentrancia: el callback típicamente hace setState, lo que
  // re-renderiza y puede reconectar el ResizeObserver. La "initial observation"
  // que dispara observe() es SÍNCRONA en el browser real, así que sin este guard
  // un re-render durante el callback podría reentrar el mismo ciclo de medición
  // y, con cierta geometría, no converger (freeze del main thread sin error de
  // React). El guard asegura que no corra una medición anidada dentro de otra.
  const runningRef = useRef(false);

  useEffect(() => {
    if (ref.current && !runningRef.current) {
      runningRef.current = true;
      try {
        callback(ref.current);
      } finally {
        runningRef.current = false;
      }
    }
  }, [ref, callback]);

  useEffect(() => {
    if (ref.current) {
      const resizeObserver = new ResizeObserver((entries) => {
        if (runningRef.current) return;
        runningRef.current = true;
        try {
          for (const entry of entries) {
            callback(entry.target as T);
          }
        } finally {
          runningRef.current = false;
        }
      });

      resizeObserver.observe(ref.current);
      return () => resizeObserver.disconnect();
    }
  }, [ref, callback]);
}
