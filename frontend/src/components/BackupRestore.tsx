/**
 * BackupRestore Component
 *
 * SECURITY FIX: Provides backup and restore functionality for wallet secrets
 *
 * Features:
 * - Export encrypted backup file
 * - Import and restore from backup
 * - Password-protected backup files
 * - Checksum verification
 */

import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { encryptData, decryptData } from '../utils/secureStorage';

// Backup file format version
const BACKUP_VERSION = 1;
const BACKUP_MAGIC = 'HMCBKP';

interface BackupData {
  magic: string;
  version: number;
  timestamp: number;
  checksum: string;
  data: string; // encrypted wallet data
}

interface BackupRestoreProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: () => Promise<object>; // Returns wallet data to export
  onImport: (data: object) => Promise<boolean>; // Imports wallet data
}

// Simple checksum for backup verification
async function computeChecksum(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function BackupRestore({ isOpen, onClose, onExport, onImport }: BackupRestoreProps) {
  const [mode, setMode] = useState<'export' | 'import'>('export');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state when closing
  const handleClose = useCallback(() => {
    setPassword('');
    setConfirmPassword('');
    setError(null);
    setSuccess(null);
    setMode('export');
    onClose();
  }, [onClose]);

  // Export backup
  const handleExport = useCallback(async () => {
    setError(null);
    setSuccess(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);
    try {
      // Get wallet data
      const walletData = await onExport();

      // Encrypt with backup password
      const encryptedData = await encryptData(walletData, password);

      // Compute checksum
      const checksum = await computeChecksum(encryptedData);

      // Create backup object
      const backup: BackupData = {
        magic: BACKUP_MAGIC,
        version: BACKUP_VERSION,
        timestamp: Date.now(),
        checksum,
        data: encryptedData,
      };

      // Download as file
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `r00t-fund-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSuccess('Backup created successfully! Store it safely.');
    } catch (err) {
      setError('Failed to create backup: ' + (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [password, confirmPassword, onExport]);

  // Import backup
  const handleImport = useCallback(async (file: File) => {
    setError(null);
    setSuccess(null);

    if (!password) {
      setError('Please enter the backup password');
      return;
    }

    setIsLoading(true);
    try {
      // Read file
      const text = await file.text();
      const backup: BackupData = JSON.parse(text);

      // Validate backup format
      if (backup.magic !== BACKUP_MAGIC) {
        throw new Error('Invalid backup file format');
      }
      if (backup.version > BACKUP_VERSION) {
        throw new Error('Backup file is from a newer version');
      }

      // Verify checksum
      const checksum = await computeChecksum(backup.data);
      if (checksum !== backup.checksum) {
        throw new Error('Backup file is corrupted (checksum mismatch)');
      }

      // Decrypt data
      const walletData = await decryptData(backup.data, password);

      // Import data
      const success = await onImport(walletData as object);
      if (success) {
        setSuccess('Wallet restored successfully!');
      } else {
        throw new Error('Failed to import wallet data');
      }
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('decrypt')) {
        setError('Incorrect password or corrupted backup');
      } else {
        setError('Failed to restore backup: ' + message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [password, onImport]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImport(file);
    }
  }, [handleImport]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-[#111] border border-[#222] rounded-2xl p-6 w-full max-w-md"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">Backup & Restore</h2>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-[#222] rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-[#888]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Mode Toggle */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => { setMode('export'); setError(null); setSuccess(null); }}
            className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
              mode === 'export'
                ? 'bg-[#00ff88] text-black'
                : 'bg-[#222] text-[#888] hover:text-white'
            }`}
          >
            Export Backup
          </button>
          <button
            onClick={() => { setMode('import'); setError(null); setSuccess(null); }}
            className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
              mode === 'import'
                ? 'bg-[#00ff88] text-black'
                : 'bg-[#222] text-[#888] hover:text-white'
            }`}
          >
            Import Backup
          </button>
        </div>

        {/* Export Mode */}
        {mode === 'export' && (
          <div className="space-y-4">
            <p className="text-[#888] text-sm">
              Create an encrypted backup of your wallet. You'll need the password to restore it.
            </p>

            <div>
              <label className="block text-[#888] text-sm mb-2">Backup Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a strong password"
                className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-4 py-3 text-white placeholder-[#555] focus:border-[#00ff88] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[#888] text-sm mb-2">Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-4 py-3 text-white placeholder-[#555] focus:border-[#00ff88] focus:outline-none"
              />
            </div>

            <button
              onClick={handleExport}
              disabled={isLoading || !password}
              className="w-full bg-[#00ff88] hover:bg-[#00cc6a] disabled:bg-[#333] disabled:cursor-not-allowed text-black font-semibold rounded-lg px-4 py-3 transition-colors"
            >
              {isLoading ? 'Creating Backup...' : 'Download Backup'}
            </button>
          </div>
        )}

        {/* Import Mode */}
        {mode === 'import' && (
          <div className="space-y-4">
            <p className="text-[#888] text-sm">
              Restore your wallet from a backup file. Enter the password used when creating the backup.
            </p>

            <div>
              <label className="block text-[#888] text-sm mb-2">Backup Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter backup password"
                className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-4 py-3 text-white placeholder-[#555] focus:border-[#00ff88] focus:outline-none"
              />
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              className="hidden"
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || !password}
              className="w-full bg-[#00ff88] hover:bg-[#00cc6a] disabled:bg-[#333] disabled:cursor-not-allowed text-black font-semibold rounded-lg px-4 py-3 transition-colors"
            >
              {isLoading ? 'Restoring...' : 'Select Backup File'}
            </button>
          </div>
        )}

        {/* Status Messages */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="mt-4 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm"
            >
              {error}
            </motion.div>
          )}
          {success && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="mt-4 bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3 text-green-400 text-sm"
            >
              {success}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Warning */}
        <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <p className="text-yellow-400 text-xs">
            <strong>Warning:</strong> Store your backup file securely. Anyone with the file and password can access your funds.
          </p>
        </div>
      </motion.div>
    </div>
  );
}

export default BackupRestore;
