import { describe, expect, it } from 'vitest';
import { evaluateSample } from '../domain/conditionEvaluator';
import { FieldsViewModel } from '../features/fields/fieldsViewModel';
import { RulesViewModel } from '../features/rules/rulesViewModel';
import { SamplesViewModel } from '../features/samples/samplesViewModel';
import { RuleWorkspaceViewModel } from '../viewmodels/workspaceViewModel';

class MemoryRepository {
  async load() { return null; }
  async save() { return undefined; }
}

class FakeChecker {
  run() { return { promise: Promise.resolve({ checkedCases: 1, coveredCases: 1, coveragePercent: 100, overlaps: [], unreachableRuleIds: [], shadowedRuleIds: [], uncoveredExamples: [], truncated: false }), cancel() {} }; }
}

describe('feature ViewModels', () => {
  it('adds typed fields, builds a rule, protects referenced fields, and evaluates a sample', async () => {
    const workspace = new RuleWorkspaceViewModel(new MemoryRepository(), new FakeChecker());
    await workspace.start();
    const fields = new FieldsViewModel(workspace);
    const rules = new RulesViewModel(workspace);
    const samples = new SamplesViewModel(workspace);
    fields.addField('boolean');
    rules.addRule();
    const addedField = workspace.getSnapshot().project?.fields.at(-1);
    expect(addedField?.type).toBe('boolean');
    expect(fields.removeField('member-level')).toBe(false);
    expect(workspace.getSnapshot().notice).toContain('仍被');
    const project = workspace.getSnapshot().project;
    expect(project).toBeDefined();
    const boolField = project?.fields.at(-1);
    if (boolField) samples.setValue(boolField.id, true);
    samples.evaluate();
    expect(workspace.getSnapshot().sampleEvaluation?.valid).toBe(true);
    workspace.dispose();
  });

  it('realigns conditions and samples when an enum option is removed, so rules stay matchable', async () => {
    const workspace = new RuleWorkspaceViewModel(new MemoryRepository(), new FakeChecker());
    await workspace.start();
    const fields = new FieldsViewModel(workspace);
    // 演示项目中 rule-gold-discount 引用了“金卡会员”，样例输入也是它
    fields.updateField('member-level', { enumValues: ['普通会员', '银卡会员'] });
    const project = workspace.getSnapshot().project;
    const goldRule = project?.rules.find((rule) => rule.id === 'rule-gold-discount');
    const condition = goldRule?.conditions.conditions[0];
    expect(condition?.kind === 'predicate' && condition.value).toBe('普通会员');
    expect(project?.sampleInputs['member-level']).toBe('普通会员');
    expect(workspace.getSnapshot().notice).toContain('失效选项引用已对齐');
    expect(workspace.getSnapshot().validationIssues.filter((issue) => issue.code === 'condition-enum')).toEqual([]);
    const evaluation = evaluateSample(project!, { ...project!.sampleInputs, 'cart-total': 1200 });
    expect(evaluation.matchedRules.map((rule) => rule.id)).toContain('rule-gold-discount');
    workspace.dispose();
  });

  it('flags conditions as invalid with a readable reason when the option list is emptied', async () => {
    const workspace = new RuleWorkspaceViewModel(new MemoryRepository(), new FakeChecker());
    await workspace.start();
    const fields = new FieldsViewModel(workspace);
    fields.updateField('member-level', { enumValues: [] });
    const issues = workspace.getSnapshot().validationIssues;
    expect(issues.map((issue) => issue.code)).toContain('condition-enum');
    const reason = issues.find((issue) => issue.code === 'condition-enum');
    expect(reason?.message).toContain('金卡大额订单');
    expect(reason?.message).toContain('金卡会员');
    expect(reason?.message).toContain('会员等级');
    const goldRule = workspace.getSnapshot().project?.rules.find((rule) => rule.id === 'rule-gold-discount');
    const condition = goldRule?.conditions.conditions[0];
    expect(condition?.kind === 'predicate' && condition.value).toBe('金卡会员');
    workspace.dispose();
  });
});
