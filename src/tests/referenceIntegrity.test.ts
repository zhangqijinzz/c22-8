import { describe, expect, it } from 'vitest';
import {
  findStaleEnumReferences,
  findStaleSampleValues,
  summarizeReferenceIntegrity,
  walkPredicates,
} from '../domain/referenceIntegrity';
import { validateProject } from '../domain/fieldValidation';
import { evaluateSample } from '../domain/conditionEvaluator';
import type { BusinessRule, RuleField, RuleProject } from '../models/ruleModel';

const tier = (values: string[]): RuleField => ({ id: 'tier', name: '会员等级', type: 'enum', enumValues: values });
const active: RuleField = { id: 'active', name: '启用', type: 'boolean' };

const ruleWith = (id: string, value: string, operator: 'eq' | 'notEq' = 'eq'): BusinessRule => ({
  id, name: id, priority: 10, result: id,
  conditions: { kind: 'group', operator: 'and', conditions: [{ kind: 'predicate', fieldId: 'tier', operator, value }] },
});

const projectOf = (fields: RuleField[], rules: BusinessRule[], sampleInputs: RuleProject['sampleInputs'] = {}): RuleProject => ({
  id: 'p', title: '测试项目', fields, rules, sampleInputs, versions: [], updatedAt: 1,
});

describe('reference integrity for enum options', () => {
  it('flags conditions whose stored value was removed from the enum options', () => {
    const project = projectOf([tier(['银卡会员', '金卡会员'])], [ruleWith('r1', '普通会员')]);
    const stale = findStaleEnumReferences(project.rules, project.fields);
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ ruleId: 'r1', fieldId: 'tier', value: '普通会员', negated: false });
    expect(stale[0].path).toEqual([0]);
  });

  it('treats a renamed option as stale for both eq and notEq, and reports negated semantics', () => {
    const project = projectOf([tier(['钻石会员'])], [
      ruleWith('eq-rule', '金卡会员', 'eq'),
      ruleWith('ne-rule', '金卡会员', 'notEq'),
    ]);
    const stale = findStaleEnumReferences(project.rules, project.fields);
    expect(stale.map((item) => item.ruleId)).toEqual(['eq-rule', 'ne-rule']);
    expect(stale.find((item) => item.ruleId === 'ne-rule')?.negated).toBe(true);
  });

  it('does not flag values that are still present, including values in OR groups', () => {
    const rule: BusinessRule = {
      id: 'or-rule', name: 'or-rule', priority: 10, result: 'x',
      conditions: { kind: 'group', operator: 'or', conditions: [
        { kind: 'predicate', fieldId: 'tier', operator: 'eq', value: '金卡会员' },
        { kind: 'predicate', fieldId: 'active', operator: 'isTrue', value: true },
      ] },
    };
    expect(findStaleEnumReferences([rule], [tier(['普通会员', '金卡会员']), active])).toEqual([]);
  });

  it('walks nested groups with index paths', () => {
    const rule: BusinessRule = {
      id: 'nested', name: 'nested', priority: 1, result: 'x',
      conditions: { kind: 'group', operator: 'and', conditions: [
        { kind: 'group', operator: 'or', conditions: [
          { kind: 'predicate', fieldId: 'tier', operator: 'eq', value: '旧选项' },
        ] },
      ] },
    };
    const paths: number[][] = [];
    walkPredicates(rule.conditions, [], (_predicate, path) => paths.push(path));
    expect(paths).toEqual([[0, 0]]);
    expect(findStaleEnumReferences([rule], [tier(['新选项'])])[0].path).toEqual([0, 0]);
  });

  it('flags stale sample inputs but keeps them available for realignment', () => {
    const stale = findStaleSampleValues({ tier: '普通会员', active: true }, [tier(['金卡会员']), active]);
    expect(stale).toEqual([{ fieldId: 'tier', fieldName: '会员等级', value: '普通会员' }]);
    expect(findStaleSampleValues({ tier: '' }, [tier(['金卡会员'])])).toEqual([]);
  });

  it('summarizes integrity of a self-contained version snapshot', () => {
    const rules = [ruleWith('r1', '旧值'), ruleWith('r2', '新值')];
    const fields = [tier(['新值'])];
    const summary = summarizeReferenceIntegrity(fields, rules, { tier: '旧值' });
    expect(summary).toEqual({ staleConditionCount: 1, staleSampleCount: 1 });
  });
});

describe('validation and evaluation surface the stale value', () => {
  it('blocks checks with a message naming rule, field and the removed value', () => {
    const project = projectOf([tier(['银卡会员', '金卡会员'])], [ruleWith('金卡规则', '普通会员')]);
    const issues = validateProject(project);
    const issue = issues.find((candidate) => candidate.code === 'condition-enum');
    expect(issue).toBeDefined();
    expect(issue?.ruleId).toBe('金卡规则');
    expect(issue?.fieldId).toBe('tier');
    expect(issue?.message).toContain('普通会员');
    expect(issue?.message).toContain('会员等级');
    expect(issue?.message).toContain('金卡规则');
  });

  it('keeps the stale rule unmatched for every valid input (the never-matches defect)', () => {
    const project = projectOf([tier(['银卡会员', '金卡会员'])], [ruleWith('r1', '普通会员')]);
    for (const value of ['银卡会员', '金卡会员']) {
      const result = evaluateSample(project, { tier: value });
      expect(result.matchedRules.map((rule) => rule.id)).not.toContain('r1');
    }
    // 直接用旧值推演时，样例输入会被判定为无效并给出原因，而不是静默地“无法复现”
    const staleInput = evaluateSample(project, { tier: '普通会员' });
    expect(staleInput.valid).toBe(false);
    expect(staleInput.errors.join('')).toContain('普通会员');
  });

  it('realigns the rule to a valid option and it starts matching again', () => {
    const project = projectOf([tier(['银卡会员', '金卡会员'])], [ruleWith('r1', '普通会员')]);
    const aligned: BusinessRule = { ...project.rules[0], conditions: { kind: 'group', operator: 'and', conditions: [
      { kind: 'predicate', fieldId: 'tier', operator: 'eq', value: '金卡会员' },
    ] } };
    const alignedProject = projectOf(project.fields, [aligned]);
    expect(validateProject(alignedProject)).toEqual([]);
    expect(evaluateSample(alignedProject, { tier: '金卡会员' }).winner?.id).toBe('r1');
  });
});
