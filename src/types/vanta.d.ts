// three 0.134 (pinned for Vanta) ships no types; only VantaFog uses it, to hand it to Vanta.
declare module 'three';

declare module 'vanta/dist/vanta.fog.min' {
  export interface VantaEffect {
    destroy(): void;
    setOptions(options: Record<string, unknown>): void;
  }
  const FOG: (options: Record<string, unknown>) => VantaEffect;
  export default FOG;
}
