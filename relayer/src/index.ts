import { createServer } from './server';

// Load environment variables
const config = {
  port: parseInt(process.env.PORT || '3000'),
  rpcUrl: process.env.RPC_URL || 'http://localhost:8545',
  zkAMMAddress: process.env.ZKAMM_ADDRESS || '',
  privateKey: process.env.PRIVATE_KEY || '',
  baseFee: process.env.BASE_FEE || '1000000000000000', // 0.001 ETH
  percentFee: process.env.PERCENT_FEE || '0.1',
  redisUrl: process.env.REDIS_URL,
};

// Validate config
if (!config.zkAMMAddress) {
  console.error('ZKAMM_ADDRESS environment variable is required');
  process.exit(1);
}

if (!config.privateKey) {
  console.error('PRIVATE_KEY environment variable is required');
  process.exit(1);
}

// Start server
const { start, queue } = createServer(config);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await queue.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await queue.close();
  process.exit(0);
});

start();
