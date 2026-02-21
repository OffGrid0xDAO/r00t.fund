/**
 * LockScreen Component
 *
 * SECURITY FIX: Password gate for encrypted wallet data
 *
 * Shows:
 * - First time: Password setup form
 * - Returning: Password unlock form
 * - Auto-locked: Re-unlock prompt
 */

import { useState, FormEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface LockScreenProps {
  isFirstTime: boolean;
  isLoading: boolean;
  error: string | null;
  onUnlock: (password: string) => Promise<boolean>;
  onSetPassword: (password: string) => Promise<boolean>;
  onReset?: () => void;
}

export function LockScreen({
  isFirstTime,
  isLoading,
  error,
  onUnlock,
  onSetPassword,
  onReset,
}: LockScreenProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [showReset, setShowReset] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (isFirstTime) {
      // Validate password strength
      if (password.length < 8) {
        setLocalError('Password must be at least 8 characters');
        return;
      }
      if (password !== confirmPassword) {
        setLocalError('Passwords do not match');
        return;
      }
      await onSetPassword(password);
    } else {
      await onUnlock(password);
    }
  };

  const handleReset = () => {
    if (onReset && window.confirm(
      'WARNING: This will delete ALL your encrypted wallet data. ' +
      'Your private keys and commitments will be lost forever. ' +
      'Only proceed if you have a backup. Continue?'
    )) {
      onReset();
      setShowReset(false);
      setPassword('');
      setConfirmPassword('');
    }
  };

  const displayError = localError || error;

  return (
    <div className="fixed inset-0 bg-[#0a0a0a] flex items-center justify-center z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#111] border border-[#222] rounded-2xl p-8 w-full max-w-md mx-4"
      >
        {/* Logo/Title */}
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">🔐</div>
          <h1 className="text-2xl font-bold text-white">
            {isFirstTime ? 'Secure Your Wallet' : 'Unlock Wallet'}
          </h1>
          <p className="text-[#888] text-sm mt-2">
            {isFirstTime
              ? 'Create a password to protect your private keys'
              : 'Enter your password to access your wallet'
            }
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Password Input */}
          <div>
            <label className="block text-[#888] text-sm mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isFirstTime ? 'Create a strong password' : 'Enter password'}
              className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-4 py-3 text-white placeholder-[#555] focus:border-[#00ff88] focus:outline-none transition-colors"
              disabled={isLoading}
              autoFocus
            />
          </div>

          {/* Confirm Password (first time only) */}
          <AnimatePresence>
            {isFirstTime && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                <label className="block text-[#888] text-sm mb-2">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your password"
                  className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-4 py-3 text-white placeholder-[#555] focus:border-[#00ff88] focus:outline-none transition-colors"
                  disabled={isLoading}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error Display */}
          <AnimatePresence>
            {displayError && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm"
              >
                {displayError}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading || !password}
            className="w-full bg-[#00ff88] hover:bg-[#00cc6a] disabled:bg-[#333] disabled:cursor-not-allowed text-black font-semibold rounded-lg px-4 py-3 transition-colors"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                {isFirstTime ? 'Setting up...' : 'Unlocking...'}
              </span>
            ) : (
              isFirstTime ? 'Create Wallet' : 'Unlock'
            )}
          </button>
        </form>

        {/* Security Info */}
        {isFirstTime && (
          <div className="mt-6 p-4 bg-[#1a1a1a] rounded-lg">
            <h3 className="text-[#00ff88] text-sm font-semibold mb-2">
              Security Information
            </h3>
            <ul className="text-[#888] text-xs space-y-1">
              <li>• Your password encrypts all private keys locally</li>
              <li>• We never store or transmit your password</li>
              <li>• If you forget your password, you cannot recover your funds</li>
              <li>• Use a unique, strong password (8+ characters)</li>
            </ul>
          </div>
        )}

        {/* Forgot Password / Reset Option */}
        {!isFirstTime && (
          <div className="mt-6 text-center">
            {!showReset ? (
              <button
                onClick={() => setShowReset(true)}
                className="text-[#666] hover:text-[#888] text-sm transition-colors"
              >
                Forgot password?
              </button>
            ) : (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                <p className="text-red-400 text-sm mb-3">
                  If you forgot your password, you can reset your wallet.
                  This will DELETE all encrypted data permanently.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowReset(false)}
                    className="flex-1 bg-[#222] hover:bg-[#333] text-white text-sm rounded-lg px-4 py-2 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleReset}
                    className="flex-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm rounded-lg px-4 py-2 transition-colors"
                  >
                    Reset Wallet
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}

export default LockScreen;
