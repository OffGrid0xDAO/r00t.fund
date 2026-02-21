/**
 * useSecureStorage - Hook for managing encrypted local storage
 *
 * SECURITY FIX: Provides UI state management for password-protected storage
 *
 * Features:
 * - Password unlock/lock
 * - Auto-lock after inactivity
 * - Session timeout
 * - Migration from plaintext to encrypted storage
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { secureStorage } from '../utils/secureStorage';

// Auto-lock timeout in milliseconds (30 minutes)
const AUTO_LOCK_TIMEOUT = 30 * 60 * 1000;

// Session activity events to track
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart'];

export interface SecureStorageState {
  isUnlocked: boolean;
  isFirstTime: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface SecureStorageActions {
  unlock: (password: string) => Promise<boolean>;
  lock: () => void;
  setPassword: (password: string) => Promise<boolean>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<boolean>;
  resetStorage: () => void;
}

export function useSecureStorage(): SecureStorageState & SecureStorageActions {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isFirstTime, setIsFirstTime] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Timer ref for auto-lock
  const autoLockTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  // Check initial state
  useEffect(() => {
    const hasData = secureStorage.hasEncryptedData();
    setIsFirstTime(!hasData);
    setIsUnlocked(secureStorage.unlocked);
    setIsLoading(false);
  }, []);

  // Reset auto-lock timer on activity
  const resetAutoLockTimer = useCallback(() => {
    lastActivityRef.current = Date.now();

    if (autoLockTimerRef.current) {
      clearTimeout(autoLockTimerRef.current);
    }

    if (isUnlocked) {
      autoLockTimerRef.current = setTimeout(() => {
        console.log('[SecureStorage] Auto-locking due to inactivity');
        secureStorage.lock();
        setIsUnlocked(false);
      }, AUTO_LOCK_TIMEOUT);
    }
  }, [isUnlocked]);

  // Set up activity listeners for auto-lock
  useEffect(() => {
    if (isUnlocked) {
      // Start auto-lock timer
      resetAutoLockTimer();

      // Listen for activity
      const handleActivity = () => resetAutoLockTimer();
      ACTIVITY_EVENTS.forEach(event => {
        window.addEventListener(event, handleActivity, { passive: true });
      });

      return () => {
        if (autoLockTimerRef.current) {
          clearTimeout(autoLockTimerRef.current);
        }
        ACTIVITY_EVENTS.forEach(event => {
          window.removeEventListener(event, handleActivity);
        });
      };
    }
  }, [isUnlocked, resetAutoLockTimer]);

  // Unlock with password
  const unlock = useCallback(async (password: string): Promise<boolean> => {
    setError(null);
    setIsLoading(true);

    try {
      const success = await secureStorage.unlock(password);
      if (success) {
        setIsUnlocked(true);
        setIsFirstTime(false);
        resetAutoLockTimer();
      } else {
        setError('Incorrect password');
      }
      return success;
    } catch (err) {
      setError('Failed to unlock: ' + (err as Error).message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [resetAutoLockTimer]);

  // Lock storage
  const lock = useCallback(() => {
    secureStorage.lock();
    setIsUnlocked(false);
    if (autoLockTimerRef.current) {
      clearTimeout(autoLockTimerRef.current);
    }
  }, []);

  // Set password (first time setup)
  const setPassword = useCallback(async (password: string): Promise<boolean> => {
    if (!isFirstTime) {
      setError('Password already set. Use changePassword instead.');
      return false;
    }

    setError(null);
    setIsLoading(true);

    try {
      const success = await secureStorage.unlock(password);
      if (success) {
        setIsUnlocked(true);
        setIsFirstTime(false);
        resetAutoLockTimer();
      }
      return success;
    } catch (err) {
      setError('Failed to set password: ' + (err as Error).message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isFirstTime, resetAutoLockTimer]);

  // Change password
  const changePassword = useCallback(async (
    oldPassword: string,
    newPassword: string
  ): Promise<boolean> => {
    setError(null);
    setIsLoading(true);

    try {
      const success = await secureStorage.changePassword(oldPassword, newPassword);
      if (!success) {
        setError('Current password is incorrect');
      }
      return success;
    } catch (err) {
      setError('Failed to change password: ' + (err as Error).message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Reset storage (clear all encrypted data)
  const resetStorage = useCallback(() => {
    secureStorage.clearAll();
    setIsUnlocked(false);
    setIsFirstTime(true);
    setError(null);
  }, []);

  return {
    // State
    isUnlocked,
    isFirstTime,
    isLoading,
    error,
    // Actions
    unlock,
    lock,
    setPassword,
    changePassword,
    resetStorage,
  };
}

export default useSecureStorage;
