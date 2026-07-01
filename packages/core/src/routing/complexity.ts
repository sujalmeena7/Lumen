import type { ChatMessage } from '../types.js';
import { estimatePromptTokens } from '../pricing/cost.js';

/**
 * Result of analyzing a prompt for routing.
 * `score` is normalized to [0, 1] where higher means "more complex" and thus
 * more deserving of a frontier model.
 */
export interface ComplexityResult {
  score: number;
  signals: Record<string, number>;
  promptTokens: number;
}

/** Keywords that indicate multi-step reasoning / hard tasks. */
const REASONING_KEYWORDS = [
  'reason',
  'reasoning',
  'step by step',
  'step-by-step',
  'prove',
  'proof',
  'derive',
  'analyze',
  'analyse',
  'explain why',
  'strategy',
  'architecture',
  'design a',
  'debug',
  'optimize',
  'algorithm',
  'trade-off',
  'tradeoff',
  'plan',
  'refactor',
];

/** Keywords that indicate simple/mechanical tasks. */
const SIMPLE_KEYWORDS = [
  'extract',
  'classify',
  'translate',
  'summarize in one',
  'yes or no',
  'true or false',
  'list the',
  'what is the capital',
  'spell',
  'rephrase',
];

/**
 * Deterministic heuristic complexity scorer.
 *
 * Signals (each contributes a weighted amount to the raw score):
 *  - length: longer prompts tend to be more complex
 *  - codeBlocks: presence of fenced code implies technical/code tasks
 *  - reasoningKeywords: explicit reasoning/multi-step language
 *  - structuredOutput: requests for JSON/schema output
 *  - questionDepth: multiple questions / multi-part requests
 *  - simpleKeywords: negative signal for mechanical tasks
 *
 * The function is pure and side-effect free so it is fully unit-testable.
 */
export function scoreComplexity(messages: ChatMessage[]): ComplexityResult {
  const text = messages
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('\n')
    .toLowerCase();

  const promptTokens = estimatePromptTokens(messages);

  // --- individual signals, each roughly normalized to [0, 1] ---
  const lengthSignal = clamp01(promptTokens / 1500);

  const codeBlockCount = (text.match(/```/g)?.length ?? 0) / 2;
  const codeSignal = clamp01(codeBlockCount / 2);

  const reasoningHits = countHits(text, REASONING_KEYWORDS);
  const reasoningSignal = clamp01(reasoningHits / 3);

  const structuredOutput =
    /\bjson\b|\bschema\b|\byaml\b|response_format|as a table|in the format/.test(text)
      ? 1
      : 0;
  const structuredSignal = structuredOutput * 0.5;

  const questionCount = (text.match(/\?/g)?.length ?? 0);
  const questionSignal = clamp01(questionCount / 4);

  const simpleHits = countHits(text, SIMPLE_KEYWORDS);
  const simplePenalty = clamp01(simpleHits / 2);

  const signals: Record<string, number> = {
    length: lengthSignal,
    codeBlocks: codeSignal,
    reasoningKeywords: reasoningSignal,
    structuredOutput: structuredSignal,
    questionDepth: questionSignal,
    simplePenalty,
  };

  // Weighted blend. Weights chosen so that a clearly complex prompt (reasoning
  // + code) lands >0.6 and a clearly simple one (extract/classify) <0.3.
  // Reasoning and code signals dominate; the simple-task penalty can drive the
  // score to zero for mechanical requests.
  const raw =
    0.15 * lengthSignal +
    0.3 * codeSignal +
    0.45 * reasoningSignal +
    0.2 * structuredSignal +
    0.15 * questionSignal -
    0.5 * simplePenalty;

  return { score: clamp01(raw), signals, promptTokens };
}

function countHits(text: string, keywords: string[]): number {
  let n = 0;
  for (const kw of keywords) if (text.includes(kw)) n++;
  return n;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
