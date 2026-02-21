/**
 * Real-time trade subscription via WebSocket (eth_subscribe)
 *
 * Subscribes directly to TokensPurchased and TokensSold contract events
 * via the RPC node's WebSocket connection. When a trade happens on-chain,
 * the node pushes the event instantly — no polling needed.
 *
 * This replaces the 5-second polling loop for trade detection.
 * The Ponder indexer still handles historical data and chart persistence.
 */

import { useEffect, useRef } from 'react';
import { usePublicClient } from 'wagmi';
import { CONTRACTS } from '../config';
import { TRADE_COMPLETE_EVENT } from '../components/PriceChart';
import { usePageVisibility } from './usePageVisibility';

// Minimal ABI for trade events (matches both Router and Pair contracts)
const TRADE_EVENTS_ABI = [
  {
    type: 'event',
    name: 'TokensPurchased',
    inputs: [
      { type: 'uint256', indexed: false, name: 'ethIn' },
      { type: 'uint256', indexed: false, name: 'tokensOut' },
    ],
  },
  {
    type: 'event',
    name: 'TokensSold',
    inputs: [
      { type: 'uint256', indexed: false, name: 'tokensIn' },
      { type: 'uint256', indexed: false, name: 'ethOut' },
    ],
  },
] as const;

/**
 * Hook that subscribes to on-chain trade events via WebSocket.
 * When a buy or sell is detected, dispatches TRADE_COMPLETE_EVENT
 * so the chart and other components refresh instantly.
 *
 * Uses viem's watchContractEvent which automatically uses eth_subscribe
 * when a WebSocket transport is available (instant push, zero polling).
 * Falls back to polling if WebSocket is unavailable.
 */
export function useTradeSubscription() {
  const publicClient = usePublicClient();
  const isPageVisible = usePageVisibility();
  const lastEventTime = useRef(0);

  useEffect(() => {
    if (!publicClient || !isPageVisible) return;

    const pairAddress = CONTRACTS.zkAMMPair as `0x${string}`;
    const routerAddress = CONTRACTS.zkAMMRouter as `0x${string}`;

    if (!pairAddress || pairAddress === '0x...') return;

    // Debounce: avoid firing multiple events for the same trade
    // (a single trade may emit events from both Router and Pair)
    const dispatchTrade = () => {
      const now = Date.now();
      if (now - lastEventTime.current < 1000) return; // 1s debounce
      lastEventTime.current = now;
      window.dispatchEvent(new CustomEvent(TRADE_COMPLETE_EVENT));
    };

    const unwatchers: (() => void)[] = [];

    // Watch Pair contract for buy events
    unwatchers.push(
      publicClient.watchContractEvent({
        address: pairAddress,
        abi: TRADE_EVENTS_ABI,
        eventName: 'TokensPurchased',
        onLogs: (logs) => {
          console.log(`[TradeSubscription] Buy detected (${logs.length} events)`);
          dispatchTrade();
        },
      })
    );

    // Watch Pair contract for sell events
    unwatchers.push(
      publicClient.watchContractEvent({
        address: pairAddress,
        abi: TRADE_EVENTS_ABI,
        eventName: 'TokensSold',
        onLogs: (logs) => {
          console.log(`[TradeSubscription] Sell detected (${logs.length} events)`);
          dispatchTrade();
        },
      })
    );

    // Also watch Router if it's a different address (trades can come from either)
    if (routerAddress && routerAddress !== '0x...' && routerAddress.toLowerCase() !== pairAddress.toLowerCase()) {
      unwatchers.push(
        publicClient.watchContractEvent({
          address: routerAddress,
          abi: TRADE_EVENTS_ABI,
          eventName: 'TokensPurchased',
          onLogs: () => dispatchTrade(),
        })
      );

      unwatchers.push(
        publicClient.watchContractEvent({
          address: routerAddress,
          abi: TRADE_EVENTS_ABI,
          eventName: 'TokensSold',
          onLogs: () => dispatchTrade(),
        })
      );
    }

    console.log('[TradeSubscription] Subscribed to trade events via WebSocket');

    return () => {
      unwatchers.forEach(unwatch => unwatch());
      console.log('[TradeSubscription] Unsubscribed from trade events');
    };
  }, [publicClient, isPageVisible]);
}
