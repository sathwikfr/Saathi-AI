/**
 * Claude (Anthropic API) for the two text features that need judgement:
 * "Ask about Amma" (lib/familyAsk.ts) and the scam check (lib/scamCheck.ts).
 * Never used in the calling pipeline (that is Sarvam; CLAUDE.md rule 7).
 *
 * Off until ANTHROPIC_API_KEY is set. Model: claude-sonnet-5-5 (~half the price of Opus, enough for summarising records; see plans.ts) unless ANTHROPIC_MODEL
 * says otherwise. Requests opt into server-side refusal fallbacks ("default"), so a
 * safety-classifier decline is retried on Anthropic's recommended model instead of failing.
 */
import Anthropic from '@anthropic-ai/sdk';

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5-5';
/** Server-side fallback on a refusal; "default" lets Anthropic pick the model by refusal category. */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

declare global {
  // eslint-disable-next-line no-var
  var __carecircle_anthropic: Anthropic | undefined;
}

export function isClaudeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.ANTHROPIC_API_KEY?.trim();
}

export function claudeModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.ANTHROPIC_MODEL?.trim() || DEFAULT_CLAUDE_MODEL;
}

/** One client per process (reused across requests). Null when not configured. */
export function getClaude(): Anthropic | null {
  if (!isClaudeConfigured()) return null;
  if (!global.__carecircle_anthropic) {
    global.__carecircle_anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!.trim(), timeout: 60_000, maxRetries: 2 });
  }
  return global.__carecircle_anthropic;
}

/** A short, safe description of an API failure for logs (never the key or the prompt). */
export function describeClaudeError(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) return 'rate limited';
  if (err instanceof Anthropic.AuthenticationError) return 'ANTHROPIC_API_KEY rejected';
  if (err instanceof Anthropic.BadRequestError) return `bad request: ${err.message.slice(0, 200)}`;
  if (err instanceof Anthropic.APIError) return `API error ${err.status ?? ''}`.trim();
  if (err instanceof Error) return err.name;
  return 'unknown error';
}
