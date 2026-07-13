/**
 * OHLCV Candlestick Chart Component
 *
 * Professional candlestick chart with volume subplot, matching r00t.fund aesthetic.
 * Features:
 * - 5-minute candle aggregation with gap handling
 * - Interactive crosshair with price/time tooltip
 * - Volume subplot (20% height)
 * - Current price line
 * - Time discontinuity markers
 * - Responsive pan/zoom support
 *
 * Uses pure SVG for rendering to match existing chart patterns.
 */

import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import type { OHLCVChartProps, Candle } from './types';
import {
  aggregateToCandles,
  convertPriceHistoryTrades,
  calculatePriceRange,
  calculateVolumeRange,
  formatGapDuration,
} from './aggregateCandles';

// Chart constants
const CANDLE_GAP = 2; // Gap between candles
const WICK_WIDTH = 1;
const VOLUME_HEIGHT_RATIO = 0.2; // 20% for volume subplot
const Y_AXIS_WIDTH = 36; // Width reserved for Y-axis labels

// Zoom levels for X-axis (candle width multiplier) - lower = more candles visible
const X_ZOOM_LEVELS = [0.02, 0.04, 0.08, 0.15, 0.25, 0.4, 0.6, 1, 1.5, 2, 3];
// Zoom levels for Y-axis (price padding multiplier - smaller = more zoomed in on price)
const Y_ZOOM_LEVELS = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.4, 0.8];

export function OHLCVChart({
  trades,
  symbol: _symbol = 'R00T/ETH',
  timeframe = 5,
  height = 280,
  showVolume = true,
  className = '',
  onCandleHover,
  onCandleClick,
  currentPrice,
  isPositive = true,
  isLoading = false,
}: OHLCVChartProps) {
  // Symbol reserved for future use in chart header
  void _symbol;
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 400, height: typeof height === 'number' ? height : 280 });
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);

  // Drag/pan state
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartY, setDragStartY] = useState(0);
  const [viewOffset, setViewOffset] = useState(0); // How many candles to offset from the end (0 = latest)
  const dragStartOffset = useRef(0);

  // Drag mode: 'pan' (chart area), 'zoomX' (x-axis), 'zoomY' (y-axis)
  const [dragMode, setDragMode] = useState<'pan' | 'zoomX' | 'zoomY' | null>(null);
  const dragStartZoomX = useRef(0);
  const dragStartZoomY = useRef(0);

  // Zoom state
  const [xZoomIndex, setXZoomIndex] = useState(7); // Default to 1x (index 7)
  const [yZoomIndex, setYZoomIndex] = useState(3); // Default to 0.05 padding (index 3)
  const xZoom = X_ZOOM_LEVELS[xZoomIndex];
  const yZoom = Y_ZOOM_LEVELS[yZoomIndex];

  // Track previous candle count for animating only new candles
  const prevCandleCountRef = useRef(0);

  // Resize observer for responsive width
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDimensions({
          width: entry.contentRect.width,
          height: typeof height === 'number' ? height : entry.contentRect.height,
        });
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [height]);

  // Reset view offset when timeframe or trades change significantly
  useEffect(() => {
    setViewOffset(0);
  }, [timeframe]);

  // Convert trades to our format and aggregate into candles
  const allCandles = useMemo(() => {
    // Handle both raw Trade[] and usePriceHistory format
    const normalizedTrades = trades.length > 0 && 'type' in trades[0]
      ? convertPriceHistoryTrades(trades as any)
      : trades;

    return aggregateToCandles(normalizedTrades, {
      intervalMs: timeframe * 60 * 1000,
    });
  }, [trades, timeframe]);

  // Track new candles for animation
  const newCandleStartIndex = prevCandleCountRef.current;

  // Update previous candle count after render
  useEffect(() => {
    prevCandleCountRef.current = allCandles.length;
  }, [allCandles.length]);

  // Calculate chart dimensions
  const chartHeight = dimensions.height;
  const volumeHeight = showVolume ? chartHeight * VOLUME_HEIGHT_RATIO : 0;
  const priceChartHeight = chartHeight - volumeHeight - 24; // 24px for time axis
  const chartWidth = dimensions.width;

  // Candle width based on X zoom level
  const candleWidth = Math.round(12 * xZoom);
  const candleStep = candleWidth + CANDLE_GAP;

  // Calculate how many candles fit in view
  const availableWidth = chartWidth - Y_AXIS_WIDTH - 10;
  const visibleCandleCount = Math.floor(availableWidth / candleStep);

  // Calculate visible candles based on viewOffset
  const { visibleCandles, canScrollLeft, canScrollRight, viewStartIndex } = useMemo(() => {
    const totalCandles = allCandles.length;
    if (totalCandles === 0) {
      return { visibleCandles: [], canScrollLeft: false, canScrollRight: false, viewStartIndex: 0 };
    }

    // viewOffset is how many candles back from the end we are
    const endIndex = Math.max(0, totalCandles - viewOffset);
    const startIdx = Math.max(0, endIndex - visibleCandleCount);
    const endIdx = Math.min(totalCandles, startIdx + visibleCandleCount);

    return {
      visibleCandles: allCandles.slice(startIdx, endIdx),
      canScrollLeft: startIdx > 0,
      canScrollRight: viewOffset > 0,
      viewStartIndex: startIdx,
    };
  }, [allCandles, viewOffset, visibleCandleCount]);

  // Use visible candles for price range calculation
  const candles = visibleCandles;

  // Calculate scales based on visible candles
  const { priceRange, volumeMax } = useMemo(() => {
    const priceData = calculatePriceRange(candles);
    const volumeData = calculateVolumeRange(candles);

    // Add padding to price range based on Y zoom level
    const paddedRange = priceData.range * (1 + yZoom * 2);
    const paddedMin = priceData.min - priceData.range * yZoom;

    return {
      priceRange: { min: paddedMin, max: paddedMin + paddedRange, range: paddedRange },
      volumeMax: volumeData.max || 1,
    };
  }, [candles, chartWidth, yZoom]);

  // Price to Y coordinate
  const priceToY = useCallback(
    (price: number) => {
      const normalized = (price - priceRange.min) / priceRange.range;
      return priceChartHeight - normalized * priceChartHeight + 16; // 16px top padding
    },
    [priceRange, priceChartHeight]
  );

  // Volume to height
  const volumeToHeight = useCallback(
    (volume: number) => {
      return (volume / volumeMax) * (volumeHeight - 8);
    },
    [volumeMax, volumeHeight]
  );

  // Candle index to X coordinate
  const indexToX = useCallback(
    (index: number) => {
      return Y_AXIS_WIDTH + index * (candleWidth + CANDLE_GAP);
    },
    [candleWidth]
  );

  // Drag handlers - detect which zone was clicked
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      // Only start drag on left click
      if (e.button !== 0) return;

      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      setDragStartX(e.clientX);
      setDragStartY(e.clientY);
      setIsDragging(true);

      // Determine drag mode based on click position
      const xAxisY = chartHeight - 24; // X-axis area (bottom 24px)

      if (x < Y_AXIS_WIDTH) {
        // Clicked on Y-axis area - zoom Y
        setDragMode('zoomY');
        dragStartZoomY.current = yZoomIndex;
      } else if (y > xAxisY) {
        // Clicked on X-axis area - zoom X
        setDragMode('zoomX');
        dragStartZoomX.current = xZoomIndex;
      } else {
        // Clicked on chart area - pan
        setDragMode('pan');
        dragStartOffset.current = viewOffset;
      }

      e.preventDefault();
    },
    [viewOffset, chartHeight, xZoomIndex, yZoomIndex]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragMode(null);
  }, []);

  // Global mouse up handler (in case mouse is released outside SVG)
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        setDragMode(null);
      }
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [isDragging]);

  // Mouse handlers
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Handle dragging based on mode
      if (isDragging && dragMode) {
        if (dragMode === 'pan') {
          // Pan the chart horizontally
          const dragDelta = e.clientX - dragStartX;
          const candlesDragged = Math.round(dragDelta / candleStep);
          const newOffset = Math.max(0, Math.min(
            allCandles.length - visibleCandleCount,
            dragStartOffset.current + candlesDragged
          ));
          setViewOffset(newOffset);
        } else if (dragMode === 'zoomY') {
          // Drag up = zoom in (smaller padding), drag down = zoom out
          const dragDeltaY = dragStartY - e.clientY; // Invert so up = positive
          const sensitivity = 20; // Pixels per zoom level change (lower = more responsive)
          const zoomDelta = Math.round(dragDeltaY / sensitivity);
          const newIndex = Math.max(0, Math.min(
            Y_ZOOM_LEVELS.length - 1,
            dragStartZoomY.current - zoomDelta // Subtract because smaller index = more zoomed in
          ));
          if (newIndex !== yZoomIndex) {
            setYZoomIndex(newIndex);
          }
        } else if (dragMode === 'zoomX') {
          // Drag right = zoom in (larger candles), drag left = zoom out
          const dragDeltaX = e.clientX - dragStartX;
          const sensitivity = 40; // Pixels per zoom level change
          const zoomDelta = Math.round(dragDeltaX / sensitivity);
          const newIndex = Math.max(0, Math.min(
            X_ZOOM_LEVELS.length - 1,
            dragStartZoomX.current + zoomDelta
          ));
          setXZoomIndex(newIndex);
        }
        return;
      }

      setMousePosition({ x, y });

      // Find which candle we're hovering over for callback
      const candleIndex = Math.floor((x - Y_AXIS_WIDTH) / (candleWidth + CANDLE_GAP));
      if (candleIndex >= 0 && candleIndex < candles.length) {
        onCandleHover?.(candles[candleIndex]);
      } else {
        onCandleHover?.(null);
      }
    },
    [candles, candleWidth, onCandleHover, isDragging, dragMode, dragStartX, dragStartY, candleStep, allCandles.length, visibleCandleCount]
  );

  const handleMouseLeave = useCallback(() => {
    setMousePosition(null);
    onCandleHover?.(null);
    // Don't reset isDragging here - let global handler do it
  }, [onCandleHover]);

  // Scroll wheel handler for panning and zooming
  const handleWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      e.preventDefault();

      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      const x = e.clientX - rect.left;

      // If hovering over Y-axis area, zoom Y
      if (x < Y_AXIS_WIDTH) {
        const zoomDelta = e.deltaY > 0 ? 1 : -1; // Scroll down = zoom out, scroll up = zoom in
        const newIndex = Math.max(0, Math.min(
          Y_ZOOM_LEVELS.length - 1,
          yZoomIndex + zoomDelta
        ));
        setYZoomIndex(newIndex);
        return;
      }

      // Otherwise, scroll/swipe = pan horizontally
      const scrollAmount = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      const candlesToScroll = Math.round(scrollAmount / 30);
      const newOffset = Math.max(0, Math.min(
        allCandles.length - visibleCandleCount,
        viewOffset - candlesToScroll
      ));
      setViewOffset(newOffset);
    },
    [allCandles.length, visibleCandleCount, viewOffset, yZoomIndex]
  );

  const handleCandleClick = useCallback(
    (candle: Candle) => {
      onCandleClick?.(candle);
    },
    [onCandleClick]
  );

  // Format Y-axis labels (clean rounded numbers like 10k, 1.5M)
  const formatAxisLabel = (value: number) => {
    if (value === 0) return '0';

    const absValue = Math.abs(value);

    // For very small numbers (likely ETH prices)
    if (absValue < 0.0001) return value.toExponential(1);
    if (absValue < 0.01) return value.toFixed(4);
    if (absValue < 1) return value.toFixed(3);

    // For larger numbers (likely USD market cap)
    if (absValue >= 1_000_000_000) {
      return `${(value / 1_000_000_000).toFixed(1)}B`;
    }
    if (absValue >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M`;
    }
    if (absValue >= 1_000) {
      return `${(value / 1_000).toFixed(0)}k`;
    }

    return value.toFixed(0);
  };

  // Format time for display
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Calculate Y-axis price labels
  const priceLabels = useMemo(() => {
    const labels: { price: number; y: number }[] = [];
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const price = priceRange.min + (priceRange.range * i) / steps;
      labels.push({ price, y: priceToY(price) });
    }
    return labels;
  }, [priceRange, priceToY]);

  // Current price line position
  const currentPriceY = currentPrice ? priceToY(currentPrice) : null;

  // Empty state
  if (!isLoading && candles.length === 0) {
    return (
      <div
        ref={containerRef}
        className={`relative rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] overflow-hidden ${className}`}
        style={{ height: typeof height === 'number' ? height : undefined }}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[var(--text-muted)] text-sm font-mono">// no trades for candles</span>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div
        ref={containerRef}
        className={`relative rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] overflow-hidden ${className}`}
        style={{ height: typeof height === 'number' ? height : undefined }}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full"
          />
          <span className="text-[var(--text-muted)] text-sm font-mono ml-2">loading candles...</span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] overflow-hidden ${className}`}
      style={{ height: typeof height === 'number' ? height : undefined }}
    >
      {/* Background gradient */}
      <div
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at 70% 30%, ${isPositive ? 'var(--chart-up)' : 'var(--error)'}15 0%, transparent 60%)`,
        }}
      />

      <svg
        width={dimensions.width}
        height={chartHeight}
        className="w-full"
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        style={{
          touchAction: 'none',
          cursor: isDragging
            ? (dragMode === 'zoomY' ? 'ns-resize' : dragMode === 'zoomX' ? 'ew-resize' : 'grabbing')
            : 'crosshair'
        }}
      >
        <defs>
          {/* Bullish candle gradient (green) */}
          <linearGradient id="bullishGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-up)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--chart-up)" stopOpacity="0.7" />
          </linearGradient>

          {/* Bearish candle gradient (red) */}
          <linearGradient id="bearishGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--error)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--error)" stopOpacity="0.7" />
          </linearGradient>

          {/* Volume bullish gradient */}
          <linearGradient id="volumeBullish" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-up)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="var(--chart-up)" stopOpacity="0.1" />
          </linearGradient>

          {/* Volume bearish gradient */}
          <linearGradient id="volumeBearish" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--error)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="var(--error)" stopOpacity="0.1" />
          </linearGradient>

          {/* Glow filter */}
          <filter id="candleGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Grid lines */}
        <g className="grid-lines" opacity="0.1">
          {priceLabels.map((label, i) => (
            <line
              key={`grid-${i}`}
              x1={Y_AXIS_WIDTH}
              y1={label.y}
              x2={chartWidth}
              y2={label.y}
              stroke="var(--text-muted)"
              strokeDasharray="4 4"
            />
          ))}
        </g>

        {/* Y-axis price labels */}
        <g className="y-axis">
          {priceLabels.map((label, i) => (
            <text
              key={`label-${i}`}
              x={Y_AXIS_WIDTH - 4}
              y={label.y + 3}
              textAnchor="end"
              className="text-[9px] font-mono"
              fill="var(--text-muted)"
            >
              {formatAxisLabel(label.price)}
            </text>
          ))}
        </g>

        {/* Volume subplot separator */}
        {showVolume && (
          <line
            x1={Y_AXIS_WIDTH}
            y1={priceChartHeight + 16}
            x2={chartWidth}
            y2={priceChartHeight + 16}
            stroke="var(--border)"
            strokeWidth="1"
          />
        )}

        {/* Candles */}
        <g className="candles">
          {candles.map((candle, index) => {
            const x = indexToX(index);
            const isBullish = candle.close >= candle.open;
            const bodyTop = priceToY(Math.max(candle.open, candle.close));
            const bodyBottom = priceToY(Math.min(candle.open, candle.close));
            const bodyHeight = Math.max(1, bodyBottom - bodyTop);
            const wickTop = priceToY(candle.high);
            const wickBottom = priceToY(candle.low);
            // Check if this is a new candle (absolute index >= previous count)
            const absoluteIndex = viewStartIndex + index;
            const isNewCandle = absoluteIndex >= newCandleStartIndex && newCandleStartIndex > 0;

            return (
              <g
                key={`candle-${candle.time}`}
                className="candle cursor-pointer"
                onClick={() => handleCandleClick(candle)}
              >
                {/* Gap indicator - dotted connector */}
                {candle.gapBefore && index > 0 && (
                  <g className="gap-indicator">
                    <line
                      x1={x - CANDLE_GAP}
                      y1={priceToY(candles[index - 1].close)}
                      x2={x}
                      y2={priceToY(candle.open)}
                      stroke="var(--warning)"
                      strokeWidth="1"
                      strokeDasharray="2 2"
                      opacity="0.6"
                    />
                    {/* Gap time marker */}
                    {candle.gapDuration && candle.gapDuration > 600000 && (
                      <text
                        x={x - CANDLE_GAP / 2}
                        y={(priceToY(candles[index - 1].close) + priceToY(candle.open)) / 2 - 4}
                        textAnchor="middle"
                        className="text-[7px] font-mono"
                        fill="var(--warning)"
                        opacity="0.7"
                      >
                        {formatGapDuration(candle.gapDuration)}
                      </text>
                    )}
                  </g>
                )}

                {/* Wick */}
                <line
                  x1={x + candleWidth / 2}
                  y1={wickTop}
                  x2={x + candleWidth / 2}
                  y2={wickBottom}
                  stroke={isBullish ? 'var(--chart-up)' : 'var(--error)'}
                  strokeWidth={WICK_WIDTH}
                />

                {/* Body - animate only new candles */}
                {isNewCandle ? (
                  <motion.rect
                    initial={{ scaleY: 0, opacity: 0 }}
                    animate={{ scaleY: 1, opacity: 1 }}
                    transition={{ duration: 0.3 }}
                    x={x}
                    y={bodyTop}
                    width={candleWidth}
                    height={bodyHeight}
                    fill={isBullish ? 'url(#bullishGradient)' : 'url(#bearishGradient)'}
                    stroke={isBullish ? 'var(--chart-up)' : 'var(--error)'}
                    strokeWidth="0.5"
                    rx="1"
                    style={{ transformOrigin: `${x + candleWidth / 2}px ${bodyTop + bodyHeight / 2}px` }}
                  />
                ) : (
                  <rect
                    x={x}
                    y={bodyTop}
                    width={candleWidth}
                    height={bodyHeight}
                    fill={isBullish ? 'url(#bullishGradient)' : 'url(#bearishGradient)'}
                    stroke={isBullish ? 'var(--chart-up)' : 'var(--error)'}
                    strokeWidth="0.5"
                    rx="1"
                    className="transition-all duration-200"
                  />
                )}

                {/* Volume bar */}
                {showVolume && (
                  isNewCandle ? (
                    <motion.rect
                      initial={{ scaleY: 0, opacity: 0 }}
                      animate={{ scaleY: 1, opacity: 1 }}
                      transition={{ duration: 0.3, delay: 0.1 }}
                      x={x}
                      y={chartHeight - 20 - volumeToHeight(candle.volume)}
                      width={candleWidth}
                      height={volumeToHeight(candle.volume)}
                      fill={isBullish ? 'url(#volumeBullish)' : 'url(#volumeBearish)'}
                      rx="1"
                      style={{ transformOrigin: `${x + candleWidth / 2}px ${chartHeight - 20}px` }}
                    />
                  ) : (
                    <rect
                      x={x}
                      y={chartHeight - 20 - volumeToHeight(candle.volume)}
                      width={candleWidth}
                      height={volumeToHeight(candle.volume)}
                      fill={isBullish ? 'url(#volumeBullish)' : 'url(#volumeBearish)'}
                      rx="1"
                      className="transition-all duration-200"
                    />
                  )
                )}
              </g>
            );
          })}
        </g>

        {/* Current price line */}
        {currentPriceY !== null && currentPriceY > 16 && currentPriceY < priceChartHeight + 16 && (
          <g className="current-price-line">
            <line
              x1={Y_AXIS_WIDTH}
              y1={currentPriceY}
              x2={chartWidth}
              y2={currentPriceY}
              stroke={isPositive ? 'var(--chart-up)' : 'var(--error)'}
              strokeWidth="1"
              strokeDasharray="4 2"
              opacity="0.7"
            />
            {/* Price box on left side */}
            <rect
              x={2}
              y={currentPriceY - 8}
              width="50"
              height="16"
              fill={isPositive ? 'var(--chart-up)' : 'var(--error)'}
              rx="2"
              opacity="0.9"
            />
            <text
              x={27}
              y={currentPriceY + 3}
              textAnchor="middle"
              className="text-[8px] font-mono font-medium"
              fill="white"
            >
              {formatAxisLabel(currentPrice!)}
            </text>
          </g>
        )}

        {/* Crosshair */}
        {mousePosition && (
          <g className="crosshair" pointerEvents="none">
            {/* Vertical line */}
            <line
              x1={mousePosition.x}
              y1="16"
              x2={mousePosition.x}
              y2={chartHeight - 20}
              stroke="var(--text-muted)"
              strokeWidth="1"
              strokeDasharray="2 2"
              opacity="0.5"
            />
            {/* Horizontal line */}
            <line
              x1={Y_AXIS_WIDTH}
              y1={mousePosition.y}
              x2={chartWidth}
              y2={mousePosition.y}
              stroke="var(--text-muted)"
              strokeWidth="1"
              strokeDasharray="2 2"
              opacity="0.5"
            />
          </g>
        )}

        {/* X-axis time labels (sparse) */}
        <g className="x-axis">
          {candles
            .filter((_, i) => i === 0 || i === candles.length - 1 || i % Math.max(1, Math.floor(candles.length / 4)) === 0)
            .map((candle) => {
              const originalIndex = candles.indexOf(candle);
              const x = indexToX(originalIndex) + candleWidth / 2;
              return (
                <text
                  key={`time-${candle.time}`}
                  x={x}
                  y={chartHeight - 4}
                  textAnchor="middle"
                  className="text-[8px] font-mono"
                  fill="var(--text-muted)"
                >
                  {formatTime(candle.time)}
                </text>
              );
            })}
        </g>

        {/* Draggable axis zones (subtle hover hints) */}
        {/* Y-axis drag zone */}
        <rect
          x={0}
          y={16}
          width={Y_AXIS_WIDTH}
          height={priceChartHeight}
          fill="transparent"
          className="cursor-ns-resize"
          style={{ pointerEvents: 'all' }}
        >
          <title>Drag to zoom price axis</title>
        </rect>
        {/* X-axis drag zone */}
        <rect
          x={Y_AXIS_WIDTH}
          y={chartHeight - 24}
          width={chartWidth - Y_AXIS_WIDTH}
          height={24}
          fill="transparent"
          className="cursor-ew-resize"
          style={{ pointerEvents: 'all' }}
        >
          <title>Drag to zoom time axis</title>
        </rect>
      </svg>

      {/* Scroll indicators */}
      {canScrollLeft && (
        <div className="absolute left-10 top-1/2 -translate-y-1/2 pointer-events-none">
          <motion.div
            initial={{ opacity: 0, x: 5 }}
            animate={{ opacity: 0.6, x: 0 }}
            className="text-[var(--text-muted)] text-lg"
          >
            ◀
          </motion.div>
        </div>
      )}
      {canScrollRight && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
          <motion.div
            initial={{ opacity: 0, x: -5 }}
            animate={{ opacity: 0.6, x: 0 }}
            className="text-[var(--text-muted)] text-lg"
          >
            ▶
          </motion.div>
        </div>
      )}

      {/* Jump to latest button */}
      {viewOffset > 0 && (
        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          onClick={() => setViewOffset(0)}
          className="absolute bottom-8 right-2 px-2 py-1 text-[9px] font-mono bg-[var(--accent)] text-[var(--accent-ink)] rounded hover:bg-[var(--accent-hover)] transition-colors"
        >
          LIVE →
        </motion.button>
      )}


    </div>
  );
}

export default OHLCVChart;
