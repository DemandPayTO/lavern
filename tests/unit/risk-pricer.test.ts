/**
 * Unit tests for the Risk Pricing MCP Tools (v6).
 *
 * Tests: Tool creation, event emission, session state recording.
 *
 * Note: The risk-pricer agent definition was removed in the DemandPay-Starling
 * configuration. These tests validate the MCP tools that remain available
 * for orchestrator-driven risk assessment.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SessionState } from '../../src/session/session-state.js';
import { createRiskPricingTools } from '../../src/mcp/tools/risk-pricing.js';

describe('Risk Pricing Tools', () => {
  let session: SessionState;

  beforeEach(() => {
    session = new SessionState('test-risk');
  });

  describe('MCP Tools', () => {
    it('should return exactly 2 tools', () => {
      const tools = createRiskPricingTools(session);
      expect(tools).toHaveLength(2);
    });

    it('should have request_risk_assessment and record_risk_assessment', () => {
      const tools = createRiskPricingTools(session);
      const names = tools.map((t: any) => t.name);
      expect(names).toContain('request_risk_assessment');
      expect(names).toContain('record_risk_assessment');
    });

    it('request_risk_assessment should emit event', async () => {
      const tools = createRiskPricingTools(session);
      const requestTool = tools.find((t: any) => t.name === 'request_risk_assessment') as any;

      const events: any[] = [];
      session.events.on('risk_assessment_requested', (e: any) => events.push(e));

      await requestTool.handler({ specialist_role: 'contract-reviewer', step: 'evaluator_gate' });

      expect(events).toHaveLength(1);
      expect(events[0].step).toBe('evaluator_gate');
    });

    it('record_risk_assessment should store on session', async () => {
      const tools = createRiskPricingTools(session);
      const recordTool = tools.find((t: any) => t.name === 'record_risk_assessment') as any;

      await recordTool.handler({
        step: 'evaluator_gate',
        specialist_role: 'contract-reviewer',
        overall_risk_score: 0.35,
        risk_level: 'MEDIUM',
        error_probability: 0.12,
        insurable: true,
        premium_estimate: '$250',
        recommendations: ['Review California provisions'],
      });

      expect(session.riskAssessments).toHaveLength(1);
      expect(session.riskAssessments[0].riskLevel).toBe('MEDIUM');
      expect(session.riskAssessments[0].overallRiskScore).toBe(0.35);
    });

    it('record_risk_assessment should emit event', async () => {
      const tools = createRiskPricingTools(session);
      const recordTool = tools.find((t: any) => t.name === 'record_risk_assessment') as any;

      const events: any[] = [];
      session.events.on('risk_assessment_completed', (e: any) => events.push(e));

      await recordTool.handler({
        step: 'evaluator_gate',
        specialist_role: 'contract-reviewer',
        overall_risk_score: 0.7,
        risk_level: 'HIGH',
        error_probability: 0.3,
        insurable: true,
        premium_estimate: '$500',
      });

      expect(events).toHaveLength(1);
      expect(events[0].riskLevel).toBe('HIGH');
      expect(events[0].score).toBe(0.7);
    });
  });

  describe('Session State', () => {
    it('should initialize with empty riskAssessments array', () => {
      const s = new SessionState('test');
      expect(s.riskAssessments).toEqual([]);
    });
  });
});
