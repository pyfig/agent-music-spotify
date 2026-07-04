export interface AgentProvider {
  name: string;
  generate(system: string, user: string): Promise<string>;
}
