declare module 'snarkjs' {
  export const groth16: {
    fullProve(input: any, wasm: string, zkey: string): Promise<{ proof: any; publicSignals: string[] }>;
  };
}
