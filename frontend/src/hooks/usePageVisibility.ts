import { useState, useEffect } from 'react';

/**
 * Hook to track page visibility
 * Returns true when page is visible, false when hidden (tab switched, minimized, etc.)
 * Use this to pause polling when the user isn't looking at the page
 */
export function usePageVisibility(): boolean {
  const [isVisible, setIsVisible] = useState(!document.hidden);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return isVisible;
}
