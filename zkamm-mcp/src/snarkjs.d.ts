declare module "snarkjs" {
  export const groth16: {
    fullProve(
      input: Record<string, any>,
      wasmPath: string,
      zkeyPath: string
    ): Promise<{ proof: any; publicSignals: string[] }>;
    exportSolidityCallData(proof: any, publicSignals: string[]): Promise<string>;
    verify(vkey: any, publicSignals: string[], proof: any): Promise<boolean>;
  };
}
