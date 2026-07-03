/**
 * Regression Test — Anonymisation wiring in crossProviderChat.
 *
 * The employment pipeline's privacy guarantee ("names, SINs, financial IDs
 * redacted on every Claude call") depends on crossProviderChat actually
 * applying anonymize() to outbound user messages and deanonymize() to the
 * response. anonymize.test.ts covers the redaction function itself; this
 * suite covers the WIRING — the payload that would hit the Anthropic API
 * must not contain party names or structured PII.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the request body that would be sent to the Anthropic API
const createMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: (body: unknown, _opts?: unknown) => createMock(body),
      };
    },
  };
});

vi.mock('../../src/utils/ensure-api-key.js', () => ({
  ensureApiKey: () => 'test-key',
}));

import { crossProviderChat } from '../../src/providers/cross-provider-chat.js';
import { config } from '../../src/config.js';

describe('crossProviderChat — anonymisation wiring', () => {
  beforeEach(() => {
    createMock.mockReset();
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'Draft referencing [PARTY_1] and [PARTY_2].' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    // Force the cloud path — anonymisation is skipped for provider 'local'
    (config as { provider: string }).provider = 'anthropic';
  });

  it('outbound user message contains placeholders, not party names', async () => {
    await crossProviderChat({
      system: 'You are a senior Ontario employment lawyer.',
      user: 'Jane Smith was terminated by Acme Corporation on 2026-01-15. Her SIN is 046-454-286.',
      tier: 'sonnet',
      maxTokens: 100,
      definedTerms: ['Jane Smith', 'Acme Corporation'],
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const body = createMock.mock.calls[0][0] as { messages: Array<{ content: string }>; system: string };
    const outbound = body.messages.map(m => m.content).join('\n');

    expect(outbound).not.toContain('Jane Smith');
    expect(outbound).not.toContain('Acme Corporation');
    expect(outbound).not.toContain('046-454-286'); // SIN caught by regex layer
    expect(outbound).toMatch(/\[PARTY_\d+\]/);
    // Facts the spec preserves must survive (dates preserved)
    expect(outbound).toContain('2026-01-15');
  });

  it('response is de-anonymised back to real names for the caller', async () => {
    const result = await crossProviderChat({
      system: 'You are a senior Ontario employment lawyer.',
      user: 'Jane Smith was terminated by Acme Corporation without cause.',
      tier: 'sonnet',
      maxTokens: 100,
      definedTerms: ['Jane Smith', 'Acme Corporation'],
    });

    expect(result.text).toContain('Jane Smith');
    expect(result.text).toContain('Acme Corporation');
    expect(result.text).not.toMatch(/\[PARTY_\d+\]/);
  });

  it('anonymises every user turn in multi-turn conversations consistently', async () => {
    await crossProviderChat({
      system: 'You are an interviewer.',
      messages: [
        { role: 'user', content: 'My client is Jane Smith.' },
        { role: 'assistant', content: 'Understood. What happened?' },
        { role: 'user', content: 'Jane Smith was dismissed by Acme Corporation.' },
      ],
      tier: 'sonnet',
      maxTokens: 100,
      definedTerms: ['Jane Smith', 'Acme Corporation'],
    });

    const body = createMock.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
    const userTurns = body.messages.filter(m => m.role === 'user').map(m => m.content);
    for (const turn of userTurns) {
      expect(turn).not.toContain('Jane Smith');
    }
    // Same entity → same placeholder across turns: whatever placeholder
    // replaced "Jane Smith" in turn 1 must also appear in turn 3
    const janePlaceholder = userTurns[0].match(/\[PARTY_\d+\]/)?.[0];
    expect(janePlaceholder).toBeDefined();
    expect(userTurns[1]).toContain(janePlaceholder!);
  });

  it('definedTerms: null explicitly opts out (internal non-client calls only)', async () => {
    await crossProviderChat({
      system: 'Internal quality gate.',
      user: 'Score this document by Jane Smith.',
      tier: 'sonnet',
      maxTokens: 100,
      definedTerms: null,
    });

    const body = createMock.mock.calls[0][0] as { messages: Array<{ content: string }> };
    expect(body.messages[0].content).toContain('Jane Smith');
  });
});
