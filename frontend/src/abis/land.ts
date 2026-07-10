/**
 * ABIs for the Land rail — LandFactory, Land, the parcel/$R00T ERC20s, and the
 * Uniswap v4 StateView (for live pool-price reads). Only the members the frontend
 * actually calls are included. See contracts/src/{LandFactory,Land}.sol.
 */

export const LAND_FACTORY_ABI = [
  {
    name: 'createLand',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'a',
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'region', type: 'string' },
          { name: 'boundaryHash', type: 'bytes32' },
          { name: 'topoHash', type: 'bytes32' },
          { name: 'cid', type: 'string' },
          { name: 'treasury', type: 'address' },
          { name: 'ethPriceE6', type: 'uint256' },
          { name: 'r00tPledge', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
  { name: 'landCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'lands', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
  { name: 'minR00tPledge', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'root', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  {
    name: 'LandCreated',
    type: 'event',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'land', type: 'address', indexed: false },
      { name: 'steward', type: 'address', indexed: true },
      { name: 'name', type: 'string', indexed: false },
      { name: 'r00tPledge', type: 'uint256', indexed: false },
    ],
  },
] as const;

const POOL_KEY_TUPLE = {
  name: '',
  type: 'tuple',
  components: [
    { name: 'currency0', type: 'address' },
    { name: 'currency1', type: 'address' },
    { name: 'fee', type: 'uint24' },
    { name: 'tickSpacing', type: 'int24' },
    { name: 'hooks', type: 'address' },
  ],
} as const;

export const LAND_ABI = [
  { name: 'pledgeETH', type: 'function', stateMutability: 'payable', inputs: [{ name: 'parcelId', type: 'bytes32' }], outputs: [] },
  { name: 'pledgeUSDC', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'parcelId', type: 'bytes32' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { name: 'createParcel', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'parcelId', type: 'bytes32' }, { name: 'n', type: 'string' }, { name: 'sym', type: 'string' }], outputs: [{ type: 'address' }] },
  { name: 'seedParcelLiquidity', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'parcelId', type: 'bytes32' }, { name: 'sqrtPriceX96', type: 'uint160' }, { name: 'rootAmount', type: 'uint256' }, { name: 'parcelAmount', type: 'uint256' }], outputs: [] },
  { name: 'collectParcelFees', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'parcelId', type: 'bytes32' }], outputs: [] },
  { name: 'validate', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { name: 'usdc', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'root', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'treasury', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'validated', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { name: 'rootPriceE6', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'r00tLiquidityReserve', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'parcelToken', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'address' }] },
  { name: 'parcelPoolInitialized', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { name: 'parcelPoolKey', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [POOL_KEY_TUPLE] },
] as const;

export const ERC20_ABI = [
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const;

// Uniswap v4 StateView — read a pool's sqrtPrice for live pricing.
export const STATE_VIEW_ABI = [
  {
    name: 'getSlot0',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'protocolFee', type: 'uint24' },
      { name: 'lpFee', type: 'uint24' },
    ],
  },
] as const;
