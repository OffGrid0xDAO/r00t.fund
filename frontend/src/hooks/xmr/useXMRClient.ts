import { useState, useCallback, useEffect, useRef } from 'react';

// Configuration
const XMR_NODE_API_URL = import.meta.env.VITE_XMR_NODE_API_URL || 'http://localhost:3000';

// Types
export interface DepositIntent {
  intentId: string;
  subaddress: string;
  subaddressIndex: string;
  expiresAt: number;
  expectedR00T: bigint;
  status: DepositStatus;
  xmrAmount?: bigint;
  r00tAmount?: bigint;
  confirmations?: number;
  leafIndex?: number;
  error?: string;
}

export type DepositStatus =
  | 'pending'     // Waiting for XMR payment
  | 'detected'    // Payment detected, waiting for confirmations
  | 'confirming'  // Gaining confirmations
  | 'attesting'   // Nodes signing attestation
  | 'complete'    // R00T commitment created
  | 'failed'      // Something went wrong
  | 'expired';    // Deposit window expired

export interface WithdrawalRequest {
  requestId: string;
  nullifierHash: string;
  r00tAmount: bigint;
  minXmrOut: bigint;
  xmrDestination: string;
  status: WithdrawalStatus;
  xmrTxHash?: string;
  actualXmrOut?: bigint;
  error?: string;
}

export type WithdrawalStatus =
  | 'pending'     // Awaiting nodes to process
  | 'signing'     // Nodes signing withdrawal
  | 'sending'     // Sending XMR
  | 'complete'    // XMR sent
  | 'failed';     // Something went wrong

export interface DepositQuote {
  xmrAmount: bigint;
  r00tAmount: bigint;
  r00tAfterFees: bigint;
  protocolFee: bigint;
  nodeFee: bigint;
  priceImpact: number;
  rate: bigint; // R00T per XMR
}

export interface WithdrawalQuote {
  r00tAmount: bigint;
  xmrAmount: bigint;
  priceImpact: number;
  rate: bigint; // XMR per R00T
}

export interface XMRReserves {
  xmr: bigint;
  r00t: bigint;
}

// API response types
interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Hook state
interface XMRClientState {
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  reserves: XMRReserves | null;
}

/**
 * Hook for interacting with the XMR/R00T bridge
 */
export function useXMRClient() {
  const [state, setState] = useState<XMRClientState>({
    isConnected: false,
    isLoading: false,
    error: null,
    reserves: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const depositPollingRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Check node connection
  const checkConnection = useCallback(async () => {
    try {
      const response = await fetch(`${XMR_NODE_API_URL}/v1/health`);
      const data = await response.json() as APIResponse<{ status: string }>;

      if (data.success && data.data?.status === 'healthy') {
        setState(prev => ({ ...prev, isConnected: true, error: null }));
        return true;
      }

      setState(prev => ({ ...prev, isConnected: false, error: 'Node unhealthy' }));
      return false;
    } catch (err) {
      setState(prev => ({
        ...prev,
        isConnected: false,
        error: 'Failed to connect to XMR node'
      }));
      return false;
    }
  }, []);

  // Fetch current reserves
  const fetchReserves = useCallback(async (): Promise<XMRReserves | null> => {
    try {
      const response = await fetch(`${XMR_NODE_API_URL}/v1/reserves`);
      const data = await response.json() as APIResponse<{ xmr: string; r00t: string }>;

      if (data.success && data.data) {
        const reserves: XMRReserves = {
          xmr: BigInt(data.data.xmr),
          r00t: BigInt(data.data.r00t),
        };
        setState(prev => ({ ...prev, reserves }));
        return reserves;
      }

      return null;
    } catch (err) {
      console.error('[useXMRClient] Failed to fetch reserves:', err);
      return null;
    }
  }, []);

  // Get deposit quote
  const getDepositQuote = useCallback(async (xmrAmount: bigint): Promise<DepositQuote | null> => {
    try {
      const response = await fetch(`${XMR_NODE_API_URL}/v1/deposit/quote?xmrAmount=${xmrAmount.toString()}`);
      const data = await response.json() as APIResponse<{
        xmrAmount: string;
        r00tAmount: string;
        r00tAfterFees: string;
        protocolFee: string;
        nodeFee: string;
        priceImpact: number;
        rate: string;
      }>;

      if (data.success && data.data) {
        return {
          xmrAmount: BigInt(data.data.xmrAmount),
          r00tAmount: BigInt(data.data.r00tAmount),
          r00tAfterFees: BigInt(data.data.r00tAfterFees),
          protocolFee: BigInt(data.data.protocolFee),
          nodeFee: BigInt(data.data.nodeFee),
          priceImpact: data.data.priceImpact,
          rate: BigInt(data.data.rate),
        };
      }

      return null;
    } catch (err) {
      console.error('[useXMRClient] Failed to get deposit quote:', err);
      return null;
    }
  }, []);

  // Get withdrawal quote
  const getWithdrawalQuote = useCallback(async (r00tAmount: bigint): Promise<WithdrawalQuote | null> => {
    try {
      const response = await fetch(`${XMR_NODE_API_URL}/v1/withdrawal/quote?r00tAmount=${r00tAmount.toString()}`);
      const data = await response.json() as APIResponse<{
        r00tAmount: string;
        xmrAmount: string;
        priceImpact: number;
        rate: string;
      }>;

      if (data.success && data.data) {
        return {
          r00tAmount: BigInt(data.data.r00tAmount),
          xmrAmount: BigInt(data.data.xmrAmount),
          priceImpact: data.data.priceImpact,
          rate: BigInt(data.data.rate),
        };
      }

      return null;
    } catch (err) {
      console.error('[useXMRClient] Failed to get withdrawal quote:', err);
      return null;
    }
  }, []);

  // Initiate deposit - get a unique XMR address to send to
  const initiateDeposit = useCallback(async (params: {
    userNullifier: bigint;
    userSecret: bigint;
    encryptedNote: string;
  }): Promise<DepositIntent | null> => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));

      const response = await fetch(`${XMR_NODE_API_URL}/v1/deposit/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userNullifier: params.userNullifier.toString(),
          userSecret: params.userSecret.toString(),
          encryptedNote: params.encryptedNote,
        }),
      });

      const data = await response.json() as APIResponse<{
        intentId: string;
        subaddress: string;
        subaddressIndex: string;
        expiresAt: number;
        expectedR00T: string;
      }>;

      setState(prev => ({ ...prev, isLoading: false }));

      if (data.success && data.data) {
        const intent: DepositIntent = {
          intentId: data.data.intentId,
          subaddress: data.data.subaddress,
          subaddressIndex: data.data.subaddressIndex,
          expiresAt: data.data.expiresAt,
          expectedR00T: BigInt(data.data.expectedR00T),
          status: 'pending',
        };

        return intent;
      }

      setState(prev => ({ ...prev, error: data.error || 'Failed to initiate deposit' }));
      return null;
    } catch (err) {
      console.error('[useXMRClient] Failed to initiate deposit:', err);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: 'Failed to initiate deposit'
      }));
      return null;
    }
  }, []);

  // Get deposit status
  const getDepositStatus = useCallback(async (intentId: string): Promise<DepositIntent | null> => {
    try {
      const response = await fetch(`${XMR_NODE_API_URL}/v1/deposit/status/${intentId}`);
      const data = await response.json() as APIResponse<{
        intentId: string;
        subaddress: string;
        subaddressIndex: string;
        expiresAt: number;
        expectedR00T: string;
        status: DepositStatus;
        xmrAmount?: string;
        r00tAmount?: string;
        confirmations?: number;
        leafIndex?: number;
        error?: string;
      }>;

      if (data.success && data.data) {
        return {
          intentId: data.data.intentId,
          subaddress: data.data.subaddress,
          subaddressIndex: data.data.subaddressIndex,
          expiresAt: data.data.expiresAt,
          expectedR00T: BigInt(data.data.expectedR00T),
          status: data.data.status,
          xmrAmount: data.data.xmrAmount ? BigInt(data.data.xmrAmount) : undefined,
          r00tAmount: data.data.r00tAmount ? BigInt(data.data.r00tAmount) : undefined,
          confirmations: data.data.confirmations,
          leafIndex: data.data.leafIndex,
          error: data.data.error,
        };
      }

      return null;
    } catch (err) {
      console.error('[useXMRClient] Failed to get deposit status:', err);
      return null;
    }
  }, []);

  // Poll deposit status with callback
  const watchDeposit = useCallback((
    intentId: string,
    onUpdate: (status: DepositIntent) => void,
    intervalMs: number = 5000
  ): () => void => {
    // Clear any existing polling for this intent
    const existingInterval = depositPollingRef.current.get(intentId);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    // Start polling
    const poll = async () => {
      const status = await getDepositStatus(intentId);
      if (status) {
        onUpdate(status);

        // Stop polling on terminal states
        if (['complete', 'failed', 'expired'].includes(status.status)) {
          const interval = depositPollingRef.current.get(intentId);
          if (interval) {
            clearInterval(interval);
            depositPollingRef.current.delete(intentId);
          }
        }
      }
    };

    // Poll immediately then at interval
    poll();
    const interval = setInterval(poll, intervalMs);
    depositPollingRef.current.set(intentId, interval);

    // Return cleanup function
    return () => {
      clearInterval(interval);
      depositPollingRef.current.delete(intentId);
    };
  }, [getDepositStatus]);

  // Request withdrawal (after ZK proof is submitted on-chain)
  const requestWithdrawal = useCallback(async (params: {
    requestId: string;
    xmrDestination: string;
  }): Promise<WithdrawalRequest | null> => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));

      const response = await fetch(`${XMR_NODE_API_URL}/v1/withdrawal/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      const data = await response.json() as APIResponse<{
        requestId: string;
        nullifierHash: string;
        r00tAmount: string;
        minXmrOut: string;
        xmrDestination: string;
        status: WithdrawalStatus;
      }>;

      setState(prev => ({ ...prev, isLoading: false }));

      if (data.success && data.data) {
        return {
          requestId: data.data.requestId,
          nullifierHash: data.data.nullifierHash,
          r00tAmount: BigInt(data.data.r00tAmount),
          minXmrOut: BigInt(data.data.minXmrOut),
          xmrDestination: data.data.xmrDestination,
          status: data.data.status,
        };
      }

      setState(prev => ({ ...prev, error: data.error || 'Failed to request withdrawal' }));
      return null;
    } catch (err) {
      console.error('[useXMRClient] Failed to request withdrawal:', err);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: 'Failed to request withdrawal'
      }));
      return null;
    }
  }, []);

  // Get withdrawal status
  const getWithdrawalStatus = useCallback(async (requestId: string): Promise<WithdrawalRequest | null> => {
    try {
      const response = await fetch(`${XMR_NODE_API_URL}/v1/withdrawal/status/${requestId}`);
      const data = await response.json() as APIResponse<{
        requestId: string;
        nullifierHash: string;
        r00tAmount: string;
        minXmrOut: string;
        xmrDestination: string;
        status: WithdrawalStatus;
        xmrTxHash?: string;
        actualXmrOut?: string;
        error?: string;
      }>;

      if (data.success && data.data) {
        return {
          requestId: data.data.requestId,
          nullifierHash: data.data.nullifierHash,
          r00tAmount: BigInt(data.data.r00tAmount),
          minXmrOut: BigInt(data.data.minXmrOut),
          xmrDestination: data.data.xmrDestination,
          status: data.data.status,
          xmrTxHash: data.data.xmrTxHash,
          actualXmrOut: data.data.actualXmrOut ? BigInt(data.data.actualXmrOut) : undefined,
          error: data.data.error,
        };
      }

      return null;
    } catch (err) {
      console.error('[useXMRClient] Failed to get withdrawal status:', err);
      return null;
    }
  }, []);

  // Validate XMR address
  const validateXMRAddress = useCallback(async (address: string): Promise<{
    valid: boolean;
    integrated: boolean;
    subaddress: boolean;
  } | null> => {
    try {
      const response = await fetch(`${XMR_NODE_API_URL}/v1/validate-address?address=${encodeURIComponent(address)}`);
      const data = await response.json() as APIResponse<{
        valid: boolean;
        integrated: boolean;
        subaddress: boolean;
      }>;

      if (data.success && data.data) {
        return data.data;
      }

      return null;
    } catch (err) {
      console.error('[useXMRClient] Failed to validate address:', err);
      return null;
    }
  }, []);

  // Connect WebSocket for real-time updates
  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    const wsUrl = XMR_NODE_API_URL.replace('http', 'ws') + '/v1/ws';
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[useXMRClient] WebSocket connected');
    };

    ws.onclose = () => {
      console.log('[useXMRClient] WebSocket disconnected');
      // Reconnect after delay
      setTimeout(() => {
        if (state.isConnected) {
          connectWebSocket();
        }
      }, 5000);
    };

    ws.onerror = (error) => {
      console.error('[useXMRClient] WebSocket error:', error);
    };

    wsRef.current = ws;
  }, [state.isConnected]);

  // Initialize
  useEffect(() => {
    checkConnection();
    fetchReserves();

    // Periodic reserve updates
    const reserveInterval = setInterval(fetchReserves, 30000);

    return () => {
      clearInterval(reserveInterval);
      wsRef.current?.close();
      depositPollingRef.current.forEach(interval => clearInterval(interval));
    };
  }, [checkConnection, fetchReserves]);

  return {
    ...state,
    checkConnection,
    fetchReserves,
    getDepositQuote,
    getWithdrawalQuote,
    initiateDeposit,
    getDepositStatus,
    watchDeposit,
    requestWithdrawal,
    getWithdrawalStatus,
    validateXMRAddress,
    connectWebSocket,
  };
}
