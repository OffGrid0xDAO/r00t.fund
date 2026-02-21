import { useState, useEffect, useCallback } from 'react';
import { useXMRClient, DepositIntent, DepositQuote } from '../../hooks/xmr/useXMRClient';
import { randomFieldElement } from '@r00t-fund/sdk';
import QRCode from 'qrcode';

// Format XMR amount (12 decimals)
function formatXMR(amount: bigint): string {
  const xmr = Number(amount) / 1e12;
  return xmr.toFixed(6);
}

// Format R00T amount (18 decimals)
function formatR00T(amount: bigint): string {
  const r00t = Number(amount) / 1e18;
  return r00t.toFixed(2);
}

// Parse XMR input to atomic units
function parseXMRInput(value: string): bigint {
  const parts = value.split('.');
  const whole = parts[0] || '0';
  const decimal = (parts[1] || '').padEnd(12, '0').slice(0, 12);
  return BigInt(whole + decimal);
}

interface XMRBuyPanelProps {
  onCommitmentCreated?: (commitment: {
    nullifier: bigint;
    secret: bigint;
    amount: bigint;
    leafIndex: number;
  }) => void;
}

type Step = 'input' | 'deposit' | 'confirming' | 'complete';

export function XMRBuyPanel({ onCommitmentCreated }: XMRBuyPanelProps) {
  const {
    isConnected,
    isLoading,
    error: clientError,
    reserves,
    getDepositQuote,
    initiateDeposit,
    watchDeposit,
  } = useXMRClient();

  // Form state
  const [xmrAmount, setXmrAmount] = useState<string>('');
  const [quote, setQuote] = useState<DepositQuote | null>(null);
  const [step, setStep] = useState<Step>('input');
  const [error, setError] = useState<string | null>(null);

  // Deposit state
  const [depositIntent, setDepositIntent] = useState<DepositIntent | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [userSecrets, setUserSecrets] = useState<{
    nullifier: bigint;
    secret: bigint;
  } | null>(null);

  // Fetch quote when amount changes
  useEffect(() => {
    const fetchQuote = async () => {
      if (!xmrAmount || parseFloat(xmrAmount) <= 0) {
        setQuote(null);
        return;
      }

      try {
        const amount = parseXMRInput(xmrAmount);
        const q = await getDepositQuote(amount);
        setQuote(q);
      } catch (err) {
        console.error('Failed to fetch quote:', err);
      }
    };

    const debounce = setTimeout(fetchQuote, 300);
    return () => clearTimeout(debounce);
  }, [xmrAmount, getDepositQuote]);

  // Generate QR code when deposit intent is created
  useEffect(() => {
    if (depositIntent?.subaddress) {
      const generateQR = async () => {
        try {
          // Monero URI format
          const uri = `monero:${depositIntent.subaddress}`;
          const url = await QRCode.toDataURL(uri, {
            width: 256,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' },
          });
          setQrCodeUrl(url);
        } catch (err) {
          console.error('Failed to generate QR code:', err);
        }
      };
      generateQR();
    }
  }, [depositIntent?.subaddress]);

  // Watch deposit status
  useEffect(() => {
    if (!depositIntent?.intentId || step === 'complete') return;

    const cleanup = watchDeposit(depositIntent.intentId, (status) => {
      setDepositIntent(status);

      if (status.status === 'complete' && status.leafIndex !== undefined && userSecrets) {
        setStep('complete');
        onCommitmentCreated?.({
          nullifier: userSecrets.nullifier,
          secret: userSecrets.secret,
          amount: status.r00tAmount!,
          leafIndex: status.leafIndex,
        });
      } else if (status.status === 'failed') {
        setError(status.error || 'Deposit failed');
      } else if (status.status === 'expired') {
        setError('Deposit expired. Please try again.');
      } else if (status.status === 'detected' || status.status === 'confirming') {
        setStep('confirming');
      }
    });

    return cleanup;
  }, [depositIntent?.intentId, step, watchDeposit, onCommitmentCreated, userSecrets]);

  // Handle initiate deposit
  const handleInitiateDeposit = useCallback(async () => {
    if (!quote) return;

    setError(null);

    try {
      // Generate random secrets for the commitment
      const nullifier = randomFieldElement();
      const secret = randomFieldElement();
      setUserSecrets({ nullifier, secret });

      // Create encrypted note for wallet recovery
      // In production, this would be encrypted with user's key
      const encryptedNote = JSON.stringify({
        nullifier: nullifier.toString(),
        secret: secret.toString(),
        timestamp: Date.now(),
      });

      const intent = await initiateDeposit({
        userNullifier: nullifier,
        userSecret: secret,
        encryptedNote,
      });

      if (intent) {
        setDepositIntent(intent);
        setStep('deposit');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initiate deposit');
    }
  }, [quote, initiateDeposit]);

  // Copy address to clipboard
  const copyAddress = useCallback(() => {
    if (depositIntent?.subaddress) {
      navigator.clipboard.writeText(depositIntent.subaddress);
    }
  }, [depositIntent?.subaddress]);

  // Reset to start
  const handleReset = useCallback(() => {
    setXmrAmount('');
    setQuote(null);
    setStep('input');
    setError(null);
    setDepositIntent(null);
    setQrCodeUrl('');
    setUserSecrets(null);
  }, []);

  // Render based on step
  if (!isConnected) {
    return (
      <div className="p-6 bg-gray-900 rounded-lg border border-gray-800">
        <div className="text-center text-gray-400">
          <div className="animate-pulse">Connecting to XMR bridge nodes...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-900 rounded-lg border border-gray-800">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white">Buy R00T with XMR</h2>
        {reserves && (
          <div className="text-sm text-gray-400">
            Pool: {formatXMR(reserves.xmr)} XMR / {formatR00T(reserves.r00t)} R00T
          </div>
        )}
      </div>

      {/* Error display */}
      {(error || clientError) && (
        <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded text-red-300 text-sm">
          {error || clientError}
        </div>
      )}

      {/* Step: Input */}
      {step === 'input' && (
        <div className="space-y-4">
          {/* XMR Amount Input */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">XMR Amount</label>
            <div className="relative">
              <input
                type="text"
                value={xmrAmount}
                onChange={(e) => setXmrAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="0.0"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white text-lg focus:outline-none focus:border-orange-500"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">XMR</span>
            </div>
          </div>

          {/* Quote Display */}
          {quote && (
            <div className="bg-gray-800/50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-400">You receive</span>
                <span className="text-white font-medium">{formatR00T(quote.r00tAfterFees)} R00T</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Rate</span>
                <span className="text-gray-400">1 XMR = {formatR00T(quote.rate)} R00T</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Protocol fee</span>
                <span className="text-gray-400">{formatR00T(quote.protocolFee)} R00T (0.3%)</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Node fee</span>
                <span className="text-gray-400">{formatR00T(quote.nodeFee)} R00T (0.7%)</span>
              </div>
              {quote.priceImpact > 0.1 && (
                <div className="flex justify-between text-sm text-yellow-400">
                  <span>Price impact</span>
                  <span>{quote.priceImpact.toFixed(2)}%</span>
                </div>
              )}
            </div>
          )}

          {/* Buy Button */}
          <button
            onClick={handleInitiateDeposit}
            disabled={!quote || isLoading}
            className="w-full bg-orange-600 hover:bg-orange-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium py-3 rounded-lg transition-colors"
          >
            {isLoading ? 'Loading...' : 'Get Deposit Address'}
          </button>

          {/* Info */}
          <p className="text-xs text-gray-500 text-center">
            You'll receive a unique XMR address. Send your XMR and wait for 10 confirmations (~20 min).
          </p>
        </div>
      )}

      {/* Step: Deposit Address */}
      {step === 'deposit' && depositIntent && (
        <div className="space-y-4">
          <div className="text-center">
            <div className="text-gray-400 mb-4">Send XMR to this address:</div>

            {/* QR Code */}
            {qrCodeUrl && (
              <div className="inline-block bg-white p-4 rounded-lg mb-4">
                <img src={qrCodeUrl} alt="XMR Address QR Code" className="w-48 h-48" />
              </div>
            )}

            {/* Address */}
            <div className="bg-gray-800 rounded-lg p-3 mb-4">
              <div className="font-mono text-sm text-white break-all">
                {depositIntent.subaddress}
              </div>
              <button
                onClick={copyAddress}
                className="mt-2 text-orange-400 hover:text-orange-300 text-sm"
              >
                Copy Address
              </button>
            </div>

            {/* Expected amount */}
            {quote && (
              <div className="text-sm text-gray-400">
                Expected: ~{formatR00T(quote.r00tAfterFees)} R00T
              </div>
            )}

            {/* Expiry warning */}
            <div className="text-xs text-yellow-400 mt-4">
              This address expires in {Math.max(0, Math.floor((depositIntent.expiresAt - Date.now()) / 60000))} minutes
            </div>
          </div>

          {/* Status */}
          <div className="bg-gray-800/50 rounded-lg p-4">
            <div className="flex items-center space-x-3">
              <div className="animate-pulse w-3 h-3 bg-yellow-400 rounded-full"></div>
              <span className="text-gray-300">Waiting for payment...</span>
            </div>
          </div>

          {/* Cancel */}
          <button
            onClick={handleReset}
            className="w-full text-gray-400 hover:text-white py-2 text-sm"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Step: Confirming */}
      {step === 'confirming' && depositIntent && (
        <div className="space-y-4">
          <div className="text-center">
            <div className="text-2xl mb-2">⛏️</div>
            <div className="text-xl font-medium text-white mb-2">Payment Detected!</div>
            <div className="text-gray-400">
              Waiting for confirmations ({depositIntent.confirmations || 0}/10)
            </div>
          </div>

          {/* Progress bar */}
          <div className="bg-gray-800 rounded-full h-2 overflow-hidden">
            <div
              className="bg-orange-500 h-full transition-all duration-500"
              style={{ width: `${((depositIntent.confirmations || 0) / 10) * 100}%` }}
            />
          </div>

          {/* Details */}
          <div className="bg-gray-800/50 rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">XMR Amount</span>
              <span className="text-white">{depositIntent.xmrAmount ? formatXMR(depositIntent.xmrAmount) : '--'} XMR</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">R00T Amount</span>
              <span className="text-white">{depositIntent.r00tAmount ? formatR00T(depositIntent.r00tAmount) : '--'} R00T</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Status</span>
              <span className="text-orange-400">{depositIntent.status}</span>
            </div>
          </div>

          <p className="text-xs text-gray-500 text-center">
            This usually takes ~20 minutes. You can close this page - your deposit will be credited automatically.
          </p>
        </div>
      )}

      {/* Step: Complete */}
      {step === 'complete' && depositIntent && (
        <div className="space-y-4">
          <div className="text-center">
            <div className="text-4xl mb-2">✅</div>
            <div className="text-xl font-medium text-white mb-2">Deposit Complete!</div>
            <div className="text-gray-400">
              Your R00T has been added to your anonymous balance
            </div>
          </div>

          {/* Details */}
          <div className="bg-gray-800/50 rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">XMR Deposited</span>
              <span className="text-white">{depositIntent.xmrAmount ? formatXMR(depositIntent.xmrAmount) : '--'} XMR</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">R00T Received</span>
              <span className="text-green-400">{depositIntent.r00tAmount ? formatR00T(depositIntent.r00tAmount) : '--'} R00T</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Commitment Index</span>
              <span className="text-white">#{depositIntent.leafIndex}</span>
            </div>
          </div>

          {/* Buy more button */}
          <button
            onClick={handleReset}
            className="w-full bg-orange-600 hover:bg-orange-500 text-white font-medium py-3 rounded-lg transition-colors"
          >
            Buy More R00T
          </button>

          <p className="text-xs text-gray-500 text-center">
            Your commitment is stored in your browser. You can now use it to swap, add liquidity, or withdraw.
          </p>
        </div>
      )}
    </div>
  );
}
