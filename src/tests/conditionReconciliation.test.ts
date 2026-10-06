import { describe, expect, it } from 'vitest';
import { evaluateSample } from '../domain/conditionEvaluator';
import { reconcileSnapshot } from '../domain/conditionReconciliation';
import { validateProject } from '../domain/fieldValidation';
import type { BusinessRule, RuleField, RuleProject, SampleInput } from '../models/ruleModel';

const tier: RuleField = { id: 'tier', name: '等级', type: 'enum', enumValues: ['basic', 'gold'] };
const amount: RuleField = { id: 'amount', name: '金额', type: 'number', min: 0, max: 1000 };

function makeRule(id: string, conditions: BusinessRule['conditions'], name = id): BusinessRule {
  return { id, name, conditions, priority: 10, result: id };
}

function project(rules: BusinessRule[], fields: RuleField[] = [tier, amount], sampleInputs: SampleInput = {}): RuleProject {
  return { id: 'p', title: '测试项目', fields, rules, sampleInputs, versions: [], updatedAt: 1 };
}

function firstPredicate(rule: BusinessRule) {
  const condition = rule.conditions.conditions[0];
  if (condition.kind !== 'predicate') throw new Error('expected predicate');
  return condition;
}

describe('condition reconciliation', () => {
  it('aligns stale enum condition values and sample inputs to the first valid option', () => {
    const rule = makeRule('r1', { kind: 'group', operator: 'and', conditions: [
      { kind: 'predicate', fieldId: 'tier', operator: 'eq', value: 'platinum' },
      { kind: 'group', operator: 'or', conditions: [
        { kind: 'predicate', fieldId: 'tier', operator: 'notEq', value: 'platinum' },
        { kind: 'predicate', fieldId: 'amount', operator: 'gte', value: 5 },
      ] },
    ] }, '金卡规则');
    const { snapshot, adjustments } = reconcileSnapshot(project([rule], [tier, amount], { tier: 'platinum', amount: 10 }));
    const aligned = snapshot.rules[0];
    expect(firstPredicate(aligned)).toMatchObject({ operator: 'eq', value: 'basic' });
    const nested = aligned.conditions.conditions[1];
    if (nested.kind !== 'group') throw new Error('expected group');
    expect(nested.conditions[0]).toMatchObject({ operator: 'notEq', value: 'basic' });
    expect(nested.conditions[1]).toMatchObject({ operator: 'gte', value: 5 });
    expect(snapshot.sampleInputs['tier']).toBe('basic');
    expect(snapshot.sampleInputs['amount']).toBe(10);
    expect(adjustments).toHaveLength(3);
    expect(adjustments[0]).toContain('金卡规则');
    expect(adjustments[0]).toContain('platinum');
    expect(validateProject(snapshot).filter((issue) => issue.code === 'condition-enum')).toEqual([]);
    expect(evaluateSample(snapshot, { tier: 'basic', amount: 10 }).matchedRules.map((matched) => matched.id)).toContain('r1');
  });

  it('returns the same reference when every reference is still valid', () => {
    const input = project(
      [makeRule('r1', { kind: 'group', operator: 'and', conditions: [{ kind: 'predicate', fieldId: 'tier', operator: 'eq', value: 'gold' }] })],
      [tier, amount],
      { tier: 'gold' },
    );
    const { snapshot, adjustments } = reconcileSnapshot(input);
    expect(snapshot).toBe(input);
    expect(adjustments).toEqual([]);
  });

  it('keeps the stale value when the field has no options left so validation can flag it', () => {
    const emptyTier: RuleField = { ...tier, enumValues: [] };
    const rule = makeRule('r1', { kind: 'group', operator: 'and', conditions: [{ kind: 'predicate', fieldId: 'tier', operator: 'eq', value: 'platinum' }] }, '失效规则');
    const { snapshot } = reconcileSnapshot(project([rule], [emptyTier, amount], { tier: 'platinum' }));
    expect(firstPredicate(snapshot.rules[0])).toMatchObject({ value: 'platinum' });
    expect(snapshot.sampleInputs['tier']).toBe('');
    const issues = validateProject(snapshot);
    expect(issues.map((issue) => issue.code)).toContain('condition-enum');
    const reason = issues.find((issue) => issue.code === 'condition-enum');
    expect(reason?.message).toContain('失效规则');
    expect(reason?.message).toContain('platinum');
    expect(reason?.message).toContain('等级');
  });

  it('leaves conditions on deleted fields and non-enum conditions untouched', () => {
    const rule = makeRule('r1', { kind: 'group', operator: 'and', conditions: [
      { kind: 'predicate', fieldId: 'ghost', operator: 'eq', value: 'platinum' },
      { kind: 'predicate', fieldId: 'amount', operator: 'gte', value: 500 },
    ] });
    const { snapshot, adjustments } = reconcileSnapshot(project([rule]));
    expect(snapshot.rules[0]).toBe(rule);
    expect(adjustments).toEqual([]);
  });
});
