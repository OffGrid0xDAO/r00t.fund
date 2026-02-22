import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { IDKitWidget, VerificationLevel, type ISuccessResult } from '@worldcoin/idkit';
import {
  MiniKit,
  VerificationLevel as MiniKitVerificationLevel,
  type VerifyCommandInput,
  type MiniAppVerifyActionSuccessPayload,
} from '@worldcoin/minikit-js';
import { GlowButton } from '../../ui/GlowButton';
import { WORLD_ID_APP_ID, WORLD_ID_ACTION } from '../constants';

interface StepWorldIdProps {
  worldIdEnabled: boolean;
  worldIdVerified: boolean;
  worldIdPending: boolean;
  worldIdError: string | null;
  onWorldIdSuccess: (result: ISuccessResult) => void;
  walletAddress?: string;
}

export function StepWorldId({
  worldIdEnabled,
  worldIdVerified,
  worldIdPending,
  worldIdError,
  onWorldIdSuccess,
  walletAddress,
}: StepWorldIdProps) {
  const [isInWorldApp, setIsInWorldApp] = useState(false);
  const [miniKitError, setMiniKitError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  // Detect if running inside World App
  useEffect(() => {
    try {
      MiniKit.install(WORLD_ID_APP_ID as `app_${string}`);
      setIsInWorldApp(MiniKit.isInstalled());
    } catch {
      setIsInWorldApp(false);
    }
  }, []);

  // MiniKit native verify (inside World App — no QR code)
  const handleMiniKitVerify = useCallback(async () => {
    if (!MiniKit.isInstalled()) return;

    setVerifying(true);
    setMiniKitError(null);

    try {
      const verifyPayload: VerifyCommandInput = {
        action: WORLD_ID_ACTION,
        signal: walletAddress || '',
        verification_level: MiniKitVerificationLevel.Orb,
      };

      const { finalPayload } = await MiniKit.commandsAsync.verify(verifyPayload);

      if (finalPayload.status === 'error') {
        setMiniKitError(`Verification failed: ${(finalPayload as { error_code?: string }).error_code || 'unknown error'}`);
        setVerifying(false);
        return;
      }

      // Convert MiniKit success payload to ISuccessResult format for the hook
      const successPayload = finalPayload as MiniAppVerifyActionSuccessPayload;
      const result: ISuccessResult = {
        proof: successPayload.proof,
        merkle_root: successPayload.merkle_root,
        nullifier_hash: successPayload.nullifier_hash,
        verification_level: successPayload.verification_level === 'orb'
          ? VerificationLevel.Orb
          : VerificationLevel.Device,
      };

      onWorldIdSuccess(result);
    } catch (err: unknown) {
      const error = err as Error;
      setMiniKitError(error.message || 'MiniKit verification failed');
      setVerifying(false);
    }
  }, [walletAddress, onWorldIdSuccess]);

  // --- DISABLED STATE ---
  if (!worldIdEnabled) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center py-8"
      >
        <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center"
          style={{ background: 'var(--success)', opacity: 0.15 }}>
          <svg className="w-8 h-8" style={{ color: 'var(--success)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-sm text-[var(--text-secondary)] mb-1">World ID gate is disabled</p>
        <p className="text-xs font-mono text-[var(--text-muted)]">// proceed_to_next_step</p>
      </motion.div>
    );
  }

  // --- VERIFIED STATE ---
  if (worldIdVerified) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center py-8"
      >
        {/* Verified orb animation */}
        <div className="relative w-24 h-24 mx-auto mb-6">
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{ border: '2px solid var(--success)', opacity: 0.3 }}
            animate={{ scale: [1, 1.3, 1.3], opacity: [0.3, 0, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
          <motion.div
            className="absolute inset-2 rounded-full"
            style={{ border: '2px solid var(--success)', opacity: 0.5 }}
            animate={{ scale: [1, 1.2, 1.2], opacity: [0.5, 0, 0] }}
            transition={{ duration: 2, repeat: Infinity, delay: 0.3 }}
          />
          <div
            className="absolute inset-4 rounded-full flex items-center justify-center"
            style={{ background: 'var(--success)' }}
          >
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">Verified Human</h3>
        <p className="text-xs font-mono text-[var(--text-muted)]">
          {isInWorldApp
            ? '// verified via World App — proceed to next step'
            : '// world_id_confirmed — proceed to next step'}
        </p>
      </motion.div>
    );
  }

  // --- VERIFY STATE ---
  const displayError = miniKitError || worldIdError;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Orb animation */}
      <div className="relative w-28 h-28 mx-auto">
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{ border: '2px solid var(--glow-secondary)', opacity: 0.2 }}
          animate={{ scale: [1, 1.4, 1.4], opacity: [0.2, 0, 0] }}
          transition={{ duration: 2.5, repeat: Infinity }}
        />
        <motion.div
          className="absolute inset-3 rounded-full"
          style={{ border: '2px solid var(--glow-secondary)', opacity: 0.35 }}
          animate={{ scale: [1, 1.3, 1.3], opacity: [0.35, 0, 0] }}
          transition={{ duration: 2.5, repeat: Infinity, delay: 0.4 }}
        />
        <motion.div
          className="absolute inset-6 rounded-full"
          style={{ border: '2px solid var(--glow-secondary)', opacity: 0.5 }}
          animate={{ scale: [1, 1.2, 1.2], opacity: [0.5, 0, 0] }}
          transition={{ duration: 2.5, repeat: Infinity, delay: 0.8 }}
        />
        <div
          className="absolute inset-8 rounded-full flex items-center justify-center"
          style={{ background: 'var(--glow-secondary)', color: 'var(--bg-primary)' }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
            <circle cx="12" cy="12" r="4" fill="currentColor"/>
          </svg>
        </div>
      </div>

      <div className="text-center">
        <h3 className="font-semibold text-lg text-[var(--text-primary)] mb-2">Verify Your Humanity</h3>
        <p className="text-sm text-[var(--text-secondary)] max-w-md mx-auto">
          {isInWorldApp
            ? 'Tap below to verify with your World ID. This proof stays in-app — no QR code needed.'
            : 'Prove you are a unique human via World ID. Scan the QR code with your World App, or open this page inside the World App for native verification.'}
        </p>
      </div>

      {/* Error */}
      {displayError && (
        <div className="p-3 rounded-lg text-xs text-center"
          style={{ background: 'color-mix(in srgb, var(--error) 10%, transparent)', color: 'var(--error)', border: '1px solid color-mix(in srgb, var(--error) 20%, transparent)' }}>
          {displayError}
        </div>
      )}

      {/* Pending state */}
      {(worldIdPending || verifying) ? (
        <div className="flex flex-col items-center gap-3 py-4">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            className="w-6 h-6 border-2 border-[var(--glow-secondary)] border-t-transparent rounded-full"
          />
          <span className="text-sm font-mono text-[var(--text-muted)]">
            {verifying ? '// verifying_in_world_app...' : '// awaiting_cre_w8_verification...'}
          </span>
          <p className="text-[10px] text-[var(--text-muted)] text-center max-w-xs">
            CRE Workflow W8 is validating your proof on-chain via the Chainlink DON. This can take up to 60 seconds.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Primary action: MiniKit (in-app) or IDKit (QR code) */}
          {isInWorldApp ? (
            // INSIDE WORLD APP — native verify, no QR
            <GlowButton
              onClick={handleMiniKitVerify}
              variant="primary"
              size="lg"
              className="w-full"
            >
              <span className="flex items-center justify-center gap-2">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                  <circle cx="12" cy="12" r="4" fill="currentColor"/>
                </svg>
                verify_with_world_app()
              </span>
            </GlowButton>
          ) : (
            // OUTSIDE WORLD APP — IDKit widget with QR code
            <IDKitWidget
              app_id={WORLD_ID_APP_ID as `app_${string}`}
              action={WORLD_ID_ACTION}
              signal={walletAddress || ''}
              verification_level={VerificationLevel.Orb}
              onSuccess={onWorldIdSuccess}
            >
              {({ open }: { open: () => void }) => (
                <GlowButton onClick={open} variant="primary" size="lg" className="w-full">
                  <span className="flex items-center justify-center gap-2">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                      <circle cx="12" cy="12" r="4" fill="currentColor"/>
                    </svg>
                    verify_with_world_id()
                  </span>
                </GlowButton>
              )}
            </IDKitWidget>
          )}

          {/* Environment badge */}
          <div className="flex items-center justify-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{ background: isInWorldApp ? 'var(--success)' : 'var(--glow-secondary)' }}
            />
            <span className="text-[10px] font-mono text-[var(--text-muted)]">
              {isInWorldApp
                ? '// detected: World App mini app'
                : '// mode: browser — scan QR with World App'}
            </span>
          </div>
        </div>
      )}

      {/* How it works */}
      <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
        <p className="text-[10px] font-mono text-[var(--text-muted)] mb-2">// how_it_works</p>
        <div className="space-y-1.5 text-xs text-[var(--text-secondary)]">
          <div className="flex items-start gap-2">
            <span className="text-[10px] font-mono text-[var(--accent)] mt-0.5">1.</span>
            <span>{isInWorldApp ? 'Tap verify — World App confirms your identity natively' : 'Scan the QR code with your World App (or open this page inside World App)'}</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-[10px] font-mono text-[var(--accent)] mt-0.5">2.</span>
            <span>ZK proof submitted to WorldIDGatekeeper contract on-chain</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-[10px] font-mono text-[var(--accent)] mt-0.5">3.</span>
            <span>CRE Workflow W8 (Chainlink DON) validates proof with Worldcoin API</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-[10px] font-mono text-[var(--accent)] mt-0.5">4.</span>
            <span>Your address is marked as a verified human — you can now create proposals</span>
          </div>
        </div>
      </div>

      <p className="text-[10px] font-mono text-[var(--text-muted)] text-center">
        // privacy: zero-knowledge proof — nobody learns your real identity
      </p>
    </motion.div>
  );
}
