/**
 * ShieldPanel Component
 *
 * Dedicated UI for managing Railgun shielded funds:
 * - Display spendable vs pending balance
 * - Shield ETH in-app using the SDK
 * - Link to Railway for unshielding
 *
 * POI (Private Proof of Innocence) verification takes ~1 hour
 * before shielded funds become spendable.
 */

import { useState } from 'react';
import { useAccount, useBalance, useWalletClient } from 'wagmi';
import { formatEther } from 'viem';
import { useRailgunBuy } from '../hooks/useRailgunBuy';
import { useRailgun } from '../hooks/useRailgun';
import { CONTRACTS, CHAIN } from '../config';

// Railgun official logo SVG component
const RailgunLogo = ({ className = "w-6 h-6" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 1000 1000" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M 447.5,-0.5 C 481.833,-0.5 516.167,-0.5 550.5,-0.5C 699.491,17.8839 818.657,86.8839 908,206.5C 958.669,278.324 989.169,357.991 999.5,445.5C 999.5,481.167 999.5,516.833 999.5,552.5C 979.506,704.397 907.506,824.563 783.5,913C 710.254,963.582 629.254,992.416 540.5,999.5C 513.833,999.5 487.167,999.5 460.5,999.5C 314.942,984.816 196.442,920.816 105,807.5C 42.1842,725.912 7.01755,633.578 -0.5,530.5C -0.5,509.5 -0.5,488.5 -0.5,467.5C 12.1614,318.165 76.4948,196.665 192.5,103C 267.869,45.3333 352.869,10.8333 447.5,-0.5 Z M 837.5,357.5 C 823.401,362.576 808.734,365.409 793.5,366C 776.536,366.802 759.703,365.968 743,363.5C 743.311,373.521 744.144,383.521 745.5,393.5C 773.882,395.396 801.549,391.896 828.5,383C 834.006,380.745 839.34,378.245 844.5,375.5C 816.9,399.595 784.567,411.261 747.5,410.5C 747.5,414.833 747.5,419.167 747.5,423.5C 785.176,419.903 817.676,405.236 845,379.5C 845.972,377.695 847.139,376.028 848.5,374.5C 848.376,373.893 848.043,373.56 847.5,373.5C 874.933,348.569 901.599,322.736 927.5,296C 928.449,295.383 929.282,295.549 930,296.5C 987.271,423.529 990.271,551.862 939,681.5C 877.616,819.549 774.783,911.049 630.5,956C 479.846,995.063 341.513,969.396 215.5,879C 204.032,870.031 193.032,860.531 182.5,850.5C 231.181,801.653 279.681,752.653 328,703.5C 328.536,689.451 326.536,675.784 322,662.5C 289.523,653.106 256.356,647.773 222.5,646.5C 208.303,646.191 194.303,647.691 180.5,651C 179.009,653.621 178.342,656.455 178.5,659.5C 225.493,658.332 271.493,664.499 316.5,678C 265.32,729.347 213.986,780.514 162.5,831.5C 152.845,803.399 146.678,774.399 144,744.5C 139.673,700.786 147.506,659.453 167.5,620.5C 166.998,619.479 166.332,619.312 165.5,620C 137.175,647.152 110.175,675.319 84.5,704.5C 84.631,703.761 84.4643,703.094 84,702.5C 81.2047,704.293 78.7047,706.46 76.5,709C 75.6683,709.688 75.0016,709.521 74.5,708.5C 26.0759,608.187 13.5759,503.521 37,394.5C 65.428,276.393 128.595,181.893 226.5,111C 343.957,31.0437 472.29,6.377 611.5,37C 697.186,58.1582 771.186,99.4916 833.5,161C 793.667,200.833 753.833,240.667 714,280.5C 713.517,281.448 713.351,282.448 713.5,283.5C 723.059,286.142 732.726,287.976 742.5,289C 778.694,252.472 815.194,216.305 852,180.5C 882.446,213.802 907.613,250.802 927.5,291.5C 909.64,302.178 890.307,309.011 869.5,312C 843.216,316.203 816.883,316.536 790.5,313C 768.911,309.716 747.578,305.216 726.5,299.5C 725.833,299.833 725.167,300.167 724.5,300.5C 730.894,316.41 735.894,332.744 739.5,349.5C 771.772,356.975 804.439,359.642 837.5,357.5 Z"/>
    <path d="M 623.5,157.5 C 624.167,157.5 624.5,157.167 624.5,156.5C 625.338,156.158 625.672,155.492 625.5,154.5C 649.696,126.309 675.363,99.9757 702.5,75.5C 687.786,105.23 680.786,136.73 681.5,170C 682.139,199.667 686.305,228.833 694,257.5C 704.135,293.708 713.802,330.041 723,366.5C 731.068,398.436 733.401,430.77 730,463.5C 725.881,488.86 717.214,512.527 704,534.5C 697.733,541.126 690.733,546.792 683,551.5C 694.515,512.947 697.848,473.614 693,433.5C 690.826,414.298 687.493,395.298 683,376.5C 674.288,344.319 664.955,312.319 655,280.5C 644.998,242.814 640.331,204.481 641,165.5C 634.971,187.11 632.971,209.11 635,231.5C 637.5,261.833 642.167,291.833 649,321.5C 659.14,363.059 668.806,404.725 678,446.5C 686.587,483.016 684.92,519.016 673,554.5C 672.226,556.939 670.726,558.773 668.5,560C 664.619,562.107 660.619,563.941 656.5,565.5C 663.172,519.903 661.005,474.57 650,429.5C 639.199,393.296 628.866,356.963 619,320.5C 610.507,282.573 607.507,244.24 610,205.5C 611.705,188.673 616.205,172.673 623.5,157.5 Z"/>
    <path d="M 625.5,154.5 C 624.662,154.842 624.328,155.508 624.5,156.5C 623.833,156.5 623.5,156.833 623.5,157.5C 596.781,192.385 587.281,231.719 595,275.5C 595.901,283.572 597.234,291.572 599,299.5C 611.312,346.748 623.312,394.082 635,441.5C 641.222,467.495 645.055,493.828 646.5,520.5C 646.379,538.182 643.879,555.515 639,572.5C 636.699,573.867 634.199,574.534 631.5,574.5C 634.705,545.719 633.871,517.053 629,488.5C 621.005,444.514 609.339,401.514 594,359.5C 579.262,312.802 576.595,265.469 586,217.5C 592.461,194.069 603.961,173.569 620.5,156C 621.966,155.365 623.3,154.531 624.5,153.5C 625.107,153.624 625.44,153.957 625.5,154.5 Z"/>
    <path d="M 557.5,271.5 C 561.167,271.5 564.833,271.5 568.5,271.5C 568.472,284.915 569.472,298.248 571.5,311.5C 535.576,308.09 500.409,311.757 466,322.5C 465.5,322.167 465,321.833 464.5,321.5C 470.566,310.604 478.566,301.437 488.5,294C 510.341,282.552 533.341,275.052 557.5,271.5 Z"/>
    <path d="M 363.5,410.5 C 364.167,410.5 364.5,410.167 364.5,409.5C 390.676,379.819 418.176,351.152 447,323.5C 447.167,324 447.333,324.5 447.5,325C 428.989,360.551 420.822,398.384 423,438.5C 424.045,460.104 427.045,481.437 432,502.5C 442.627,542.341 452.627,582.341 462,622.5C 478.391,698.963 459.391,764.963 405,820.5C 404.833,820 404.667,819.5 404.5,819C 424.154,776.242 431.654,731.409 427,684.5C 425.3,664.966 422.3,645.633 418,626.5C 410.779,597.949 402.779,569.615 394,541.5C 382.853,500.845 378.52,459.512 381,417.5C 376.672,429.471 374.006,441.804 373,454.5C 371.173,485.751 373.173,516.751 379,547.5C 389.539,597.864 400.206,648.197 411,698.5C 422.688,756.112 410.022,807.446 373,852.5C 371,854.5 369,856.5 367,858.5C 366.5,858 366,857.5 365.5,857C 383.923,826.066 392.256,792.566 390.5,756.5C 390.918,727.261 387.085,698.595 379,670.5C 365.864,631.288 355.864,591.288 349,550.5C 343.633,518.537 343.3,486.537 348,454.5C 350.701,438.892 355.868,424.226 363.5,410.5 Z"/>
    <path d="M 502.5,323.5 C 526.458,322.862 550.125,325.196 573.5,330.5C 574.647,330.818 575.481,331.484 576,332.5C 578.311,340.743 580.145,349.077 581.5,357.5C 539.222,347.319 496.555,345.319 453.5,351.5C 452.5,351.167 451.5,350.833 450.5,350.5C 452.429,344.812 454.762,339.312 457.5,334C 472.195,328.632 487.195,325.132 502.5,323.5 Z"/>
    <path d="M 468.5,363.5 C 484.533,363.155 500.533,363.655 516.5,365C 540.003,368.434 563.336,372.767 586.5,378C 589.657,384.127 591.49,390.627 592,397.5C 544.031,382.243 494.864,375.243 444.5,376.5C 444.704,373.482 445.037,370.482 445.5,367.5C 453.313,366.254 460.979,364.921 468.5,363.5 Z"/>
    <path d="M 593.5,400.5 C 594.117,400.611 594.617,400.944 595,401.5C 596.918,411.094 599.084,420.594 601.5,430C 553.653,478.014 505.653,525.847 457.5,573.5C 453.526,564.419 450.693,555.086 449,545.5C 497.368,497.299 545.535,448.965 593.5,400.5 Z"/>
    <path d="M 364.5,409.5 C 363.833,409.5 363.5,409.833 363.5,410.5C 334.961,445.283 323.461,485.283 329,530.5C 329.521,535.852 330.187,541.185 331,546.5C 343.806,599.392 356.14,652.392 368,705.5C 383.839,766.963 375.173,824.629 342,878.5C 345.231,867.474 348.898,856.474 353,845.5C 361.874,805.73 362.874,765.73 356,725.5C 354.052,713.425 351.718,701.425 349,689.5C 341.775,662.936 333.775,636.603 325,610.5C 313.065,570.023 310.732,529.023 318,487.5C 324.607,455.595 339.94,428.929 364,407.5C 364.464,408.094 364.631,408.761 364.5,409.5 Z"/>
    <path d="M 293.5,554.5 C 296.5,554.5 299.5,554.5 302.5,554.5C 302.706,567.896 303.706,581.229 305.5,594.5C 269.605,591.31 234.439,594.977 200,605.5C 199.5,605.167 199,604.833 198.5,604.5C 203.503,595.339 209.837,587.172 217.5,580C 241.218,566.372 266.551,557.872 293.5,554.5 Z"/>
    <path d="M 580.5,657.5 C 578.973,657.427 577.973,658.094 577.5,659.5C 558.352,669.205 538.018,674.705 516.5,676C 504.171,676.5 491.838,676.667 479.5,676.5C 478.768,666.878 477.435,657.378 475.5,648C 493.469,649.132 511.469,649.465 529.5,649C 543.808,648.116 557.808,645.616 571.5,641.5C 572.167,641.5 572.5,641.167 572.5,640.5C 575.167,640.167 575.167,639.833 572.5,639.5C 571.209,639.263 570.209,639.596 569.5,640.5C 537.155,642.577 505.155,640.077 473.5,633C 469.978,616.084 464.978,599.584 458.5,583.5C 475.873,586.008 493.206,589.508 510.5,594C 554.201,602.144 597.201,599.478 639.5,586C 648.76,582.195 657.76,578.195 666.5,574C 638.546,602.79 609.88,630.623 580.5,657.5 Z"/>
    <path d="M 237.5,606.5 C 261.863,606.046 285.863,608.712 309.5,614.5C 312.458,623.323 314.291,632.323 315,641.5C 279.791,631.977 243.957,628.81 207.5,632C 199.871,632.613 192.371,633.78 185,635.5C 186.005,628.664 188.505,622.33 192.5,616.5C 207.244,611.394 222.244,608.06 237.5,606.5 Z"/>
    <path d="M 580.5,657.5 C 581.239,657.369 581.906,657.536 582.5,658C 562.414,680.028 537.747,694.694 508.5,702C 499.6,704.15 490.6,705.65 481.5,706.5C 481.5,702.167 481.5,697.833 481.5,693.5C 517.845,693.833 549.845,682.5 577.5,659.5C 579.027,659.573 580.027,658.906 580.5,657.5 Z"/>
  </svg>
);

interface ShieldPanelProps {
  onShieldComplete?: (txHash: string, amount: bigint) => void;
}

export function ShieldPanel({ onShieldComplete }: ShieldPanelProps) {
  const { isConnected, address } = useAccount();
  const { data: ethBalance } = useBalance({
    address,
    chainId: CHAIN.id,
  });
  const { data: walletClient } = useWalletClient();

  // Get Railgun wallet and shielding functions
  const {
    hasRailgunWallet,
    railgunAddress,
    getOrCreateWallet,
    shieldETH,
    progress: railgunProgress,
    isRailgunReady,
    walletId,
    clearAndResync,
  } = useRailgunBuy(CONTRACTS.zkAMM);

  // Get balance info - pass walletId and isEngineReady for SDK balance queries
  const railgun = useRailgun({
    walletId,
    autoRefresh: hasRailgunWallet && !!walletId && isRailgunReady,
    refreshInterval: 30000, // 30 seconds
    isEngineReady: isRailgunReady,
  });

  const [shieldAmount, setShieldAmount] = useState('');
  const [isShielding, setIsShielding] = useState(false);
  const [shieldTxHash, setShieldTxHash] = useState<string | null>(null);
  const [shieldError, setShieldError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isGeneratingWallet, setIsGeneratingWallet] = useState(false);

  // Generate Railgun wallet on demand
  const handleGenerateWallet = async () => {
    setIsGeneratingWallet(true);
    try {
      await getOrCreateWallet((step, percent) => {
        console.log(`[ShieldPanel] ${step} (${percent}%)`);
      });
    } catch (err) {
      console.error('[ShieldPanel] Failed to generate wallet:', err);
      setShieldError((err as Error).message);
    } finally {
      setIsGeneratingWallet(false);
    }
  };

  // Handle shield ETH
  const handleShield = async () => {
    if (!shieldAmount || parseFloat(shieldAmount) <= 0) {
      setShieldError('Please enter an amount');
      return;
    }

    if (!walletClient) {
      setShieldError('Wallet not connected');
      return;
    }

    setIsShielding(true);
    setShieldError(null);
    setShieldTxHash(null);

    try {
      const result = await shieldETH(shieldAmount, (step, percent) => {
        console.log(`[ShieldPanel] ${step} (${percent}%)`);
      });

      setShieldTxHash(result.txHash);
      setShieldAmount('');
      onShieldComplete?.(result.txHash, result.amountShielded);

      // Success - funds will be pending for ~1 hour
    } catch (err) {
      console.error('[ShieldPanel] Shield failed:', err);
      setShieldError((err as Error).message || 'Shield transaction failed');
    } finally {
      setIsShielding(false);
    }
  };

  // Calculate max shield amount (leave some ETH for gas)
  const maxShieldAmount = ethBalance
    ? Math.max(0, Number(formatEther(ethBalance.value)) - 0.001)
    : 0;

  if (!isConnected) {
    return (
      <div className="text-center py-8">
        <p className="code-label mb-4">shield_eth</p>
        <h3 className="text-lg font-medium mb-2 text-theme-primary">connect to shield</h3>
        <p className="text-theme-muted text-sm">
          connect your wallet to shield ETH for anonymous trading
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <div className="rounded-xl p-5 bg-gradient-to-br from-purple-900/20 to-blue-900/20 border border-purple-500/30">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <RailgunLogo className="w-8 h-8 text-purple-400" />
            <p className="code-label">shield</p>
          </div>
          <span
            className="tag flex items-center gap-1.5"
            style={{ background: 'rgba(147, 51, 234, 0.2)', color: '#a855f7' }}
          >
            <span className={`w-2 h-2 rounded-full ${isRailgunReady ? 'bg-green-500' : 'bg-purple-500 animate-pulse'}`} />
            {isRailgunReady ? 'ready' : 'loading...'}
          </span>
        </div>

        <h3 className="text-xl font-bold text-theme-primary mb-2 flex items-center gap-2">
          <span>Shield ETH via Railgun</span>
        </h3>
        <p className="text-sm text-theme-muted">
          Shield your ETH to Railgun's privacy pool. Funds become spendable after ~1 hour (POI verification).
        </p>
      </div>

      {/* Railgun Wallet Section */}
      {!hasRailgunWallet ? (
        <div className="rounded-xl p-4 bg-theme-tertiary">
          <h4 className="font-medium text-theme-primary mb-3 flex items-center gap-2">
            <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            generate railgun wallet
          </h4>
          <p className="text-sm text-theme-muted mb-4">
            Sign a message to generate your Railgun wallet address. This creates a deterministic 0zk address from your connected wallet.
          </p>
          <button
            onClick={handleGenerateWallet}
            disabled={isGeneratingWallet}
            className="w-full py-3 rounded-xl bg-purple-500 text-white font-medium hover:bg-purple-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isGeneratingWallet ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                generating...
              </>
            ) : (
              'Generate 0zk Wallet'
            )}
          </button>
        </div>
      ) : (
        <>
          {/* Balance Display */}
          <div className="rounded-xl p-4 bg-theme-tertiary">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-medium text-theme-primary flex items-center gap-2">
                <RailgunLogo className="w-5 h-5 text-purple-400" />
                shielded balance
              </h4>
              <button
                onClick={() => railgun.refreshBalances()}
                disabled={railgun.isRefreshing}
                className="text-xs px-2 py-1 rounded-lg bg-theme-secondary hover:bg-theme-accent/20 text-theme-muted hover:text-theme-primary transition-colors disabled:opacity-50 flex items-center gap-1"
              >
                {railgun.isRefreshing ? (
                  <>
                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    refreshing...
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    refresh
                  </>
                )}
              </button>
            </div>

            <div className="space-y-3">
              {/* Spendable Balance */}
              <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-green-400 mb-1 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-green-500"></span>
                      spendable (POI verified)
                    </p>
                    <p className="text-lg font-bold text-green-300">
                      {railgun.spendableBalanceFormatted} WETH
                    </p>
                  </div>
                  {railgun.hasSpendableBalance && (
                    <span className="tag tag-success text-xs">ready to trade</span>
                  )}
                </div>
              </div>

              {/* Pending Balance - always show */}
              <div className={`p-3 rounded-lg ${railgun.hasPendingBalance ? 'bg-yellow-500/10 border border-yellow-500/30' : 'bg-theme-secondary/50 border border-theme-border'}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`text-xs mb-1 flex items-center gap-1 ${railgun.hasPendingBalance ? 'text-yellow-400' : 'text-theme-muted'}`}>
                      {railgun.hasPendingBalance && (
                        <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></span>
                      )}
                      {!railgun.hasPendingBalance && (
                        <span className="w-2 h-2 rounded-full bg-gray-500"></span>
                      )}
                      pending (awaiting POI)
                    </p>
                    <p className={`text-lg font-bold ${railgun.hasPendingBalance ? 'text-yellow-300' : 'text-theme-muted'}`}>
                      {railgun.pendingBalanceFormatted} WETH
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="tag text-xs" style={{ background: railgun.hasPendingBalance ? 'rgba(234, 179, 8, 0.2)' : 'rgba(100, 100, 100, 0.2)', color: railgun.hasPendingBalance ? '#eab308' : '#888' }}>
                      ~1 hour
                    </span>
                    <p className={`text-xs mt-1 ${railgun.hasPendingBalance ? 'text-yellow-400/60' : 'text-theme-muted/60'}`}>verification</p>
                  </div>
                </div>
              </div>

              {/* Total Balance */}
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-theme-secondary/50">
                <span className="text-xs text-theme-muted">total shielded</span>
                <span className="text-sm font-medium text-theme-primary">
                  {railgun.totalBalanceFormatted} WETH
                </span>
              </div>

              {/* Public ETH Balance */}
              <div className="p-3 rounded-lg bg-theme-secondary">
                <p className="text-xs text-theme-muted mb-1">public ETH balance</p>
                <p className="text-lg font-bold text-theme-primary">
                  {ethBalance ? Number(formatEther(ethBalance.value)).toFixed(4) : '0'} ETH
                </p>
              </div>

              {/* Last refresh info */}
              {railgun.lastRefresh && (
                <p className="text-xs text-theme-muted text-center">
                  last updated: {new Date(railgun.lastRefresh).toLocaleTimeString()}
                </p>
              )}

              {/* Error with resync option */}
              {railgun.error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                  <p className="text-xs text-red-400 mb-2">Sync error: {railgun.error}</p>
                  <button
                    onClick={async () => {
                      await clearAndResync();
                      window.location.reload();
                    }}
                    className="text-xs px-3 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30"
                  >
                    Clear & Resync
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Railgun Address */}
          <div className="rounded-xl p-4 bg-theme-tertiary">
            <h4 className="font-medium text-theme-primary mb-2 flex items-center gap-2">
              <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              your 0zk address
            </h4>
            <div className="p-2 rounded-lg bg-theme-secondary font-mono text-xs text-theme-muted break-all select-all">
              {railgunAddress || 'not generated'}
            </div>
            {railgunAddress && (
              <button
                onClick={() => {
                  navigator.clipboard.writeText(railgunAddress);
                }}
                className="mt-2 text-xs text-purple-400 hover:text-purple-300"
              >
                copy full address
              </button>
            )}
          </div>

          {/* Shield Form */}
          <div className="rounded-xl p-4 bg-theme-tertiary">
            <h4 className="font-medium text-theme-primary mb-3 flex items-center gap-2">
              <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              shield ETH
            </h4>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  placeholder="0.0"
                  value={shieldAmount}
                  onChange={(e) => setShieldAmount(e.target.value)}
                  className="flex-1 px-4 py-3 rounded-xl bg-theme-secondary text-theme-primary text-lg font-medium placeholder:text-theme-muted outline-none focus:ring-2 focus:ring-purple-500"
                  step="0.001"
                  min="0"
                  max={maxShieldAmount}
                />
                <button
                  onClick={() => setShieldAmount(maxShieldAmount.toFixed(4))}
                  className="px-3 py-3 rounded-xl bg-theme-secondary text-theme-muted hover:text-theme-primary transition-colors text-sm"
                >
                  max
                </button>
              </div>

              <p className="text-xs text-theme-muted">
                0.25% fee applied • ~1 hour until spendable (POI verification)
              </p>

              {shieldError && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-400">
                  {shieldError}
                </div>
              )}

              {shieldTxHash && (
                <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/30 text-sm text-green-400">
                  <p className="mb-1">Shield transaction submitted!</p>
                  <a
                    href={`https://arbiscan.io/tx/${shieldTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs underline hover:text-green-300"
                  >
                    View on Arbiscan
                  </a>
                  <p className="text-xs mt-2 text-green-300/70">
                    Funds will be spendable in ~1 hour after POI verification.
                  </p>
                </div>
              )}

              <button
                onClick={handleShield}
                disabled={isShielding || !shieldAmount || parseFloat(shieldAmount) <= 0}
                className="w-full py-4 rounded-xl bg-purple-500 text-white font-medium hover:bg-purple-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isShielding ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    {railgunProgress.step || 'shielding...'}
                  </>
                ) : (
                  'Shield ETH'
                )}
              </button>
            </div>
          </div>
        </>
      )}

      {/* How It Works */}
      <div className="rounded-xl p-4 bg-theme-tertiary">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between"
        >
          <h4 className="font-medium text-theme-primary flex items-center gap-2">
            <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            how it works
          </h4>
          <svg
            className={`w-5 h-5 text-theme-muted transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showAdvanced && (
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center flex-shrink-0 text-xs font-bold">
                1
              </div>
              <div>
                <p className="text-theme-primary font-medium">Shield ETH</p>
                <p className="text-theme-muted text-xs">
                  ETH is wrapped to WETH and shielded to Railgun's privacy pool
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center flex-shrink-0 text-xs font-bold">
                2
              </div>
              <div>
                <p className="text-theme-primary font-medium">Wait ~1 hour (POI)</p>
                <p className="text-theme-muted text-xs">
                  Private Proof of Innocence verification ensures funds are clean
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center flex-shrink-0 text-xs font-bold">
                3
              </div>
              <div>
                <p className="text-theme-primary font-medium">Trade Anonymously</p>
                <p className="text-theme-muted text-xs">
                  Use "Full Anonymous" mode in swap to buy with shielded funds
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center flex-shrink-0 text-xs font-bold">
                4
              </div>
              <div>
                <p className="text-theme-primary font-medium">Unshield to Exit</p>
                <p className="text-theme-muted text-xs">
                  Withdraw to any address via Railway — no connection to original funds
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* External Links */}
      <div className="flex gap-2">
        <button
          onClick={railgun.openShield}
          className="flex-1 btn-ghost py-3 text-center text-sm flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          Railway
        </button>
        <a
          href={`https://arbiscan.io/address/${railgun.RAILGUN_PROXY}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 btn-ghost py-3 text-center text-sm flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Contract
        </a>
        <a
          href="https://docs.railgun.org"
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 btn-ghost py-3 text-center text-sm flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          Docs
        </a>
      </div>

      {/* Privacy Notice */}
      <div className="p-4 rounded-xl bg-theme-tertiary">
        <p className="flex items-center gap-3 text-xs text-theme-muted">
          <span className="status-dot-active"></span>
          <span>
            <span className="text-purple-400">// privacy pool</span>
            {' '}— Railgun on Arbitrum has $70M+ TVL for maximum anonymity
          </span>
        </p>
      </div>
    </div>
  );
}
