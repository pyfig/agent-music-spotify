export interface AgentProvider {
  name: string;
  generate(
    system: string,
    user: string,
    onToken?: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<string>;
}
