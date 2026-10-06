import type {
  BusinessRule,
  RuleCondition,
  RuleField,
  SampleInput,
} from '../models/ruleModel';
import { fieldLabel } from '../models/ruleModel';

export interface ReconcilableSnapshot {
  fields: RuleField[];
  rules: BusinessRule[];
  sampleInputs: SampleInput;
}

export interface ReconciledSnapshot<T extends ReconcilableSnapshot> {
  snapshot: T;
  adjustments: string[];
}

/**
 * 字段枚举选项变化后，把引用失效选项的规则条件和样例输入对齐到有效取值，
 * 保证界面显示的值和实际参与判断的值始终一致。字段已没有任何选项时无法
 * 对齐，保留原值，由校验和界面把它明确标记为失效。项目与版本快照共用此口径。
 */
export function reconcileSnapshot<T extends ReconcilableSnapshot>(input: T): ReconciledSnapshot<T> {
  const fieldById = new Map(input.fields.map((field) => [field.id, field]));
  const adjustments: string[] = [];
  let rulesChanged = false;
  const rules = input.rules.map((rule) => {
    const conditions = reconcileCondition(rule.conditions, fieldById, rule, adjustments);
    if (conditions === rule.conditions) return rule;
    rulesChanged = true;
    return { ...rule, conditions };
  });
  let sampleInputs = input.sampleInputs;
  let samplesChanged = false;
  const nextSamples: SampleInput = { ...input.sampleInputs };
  for (const field of input.fields) {
    if (field.type !== 'enum') continue;
    const value = nextSamples[field.id];
    if (typeof value !== 'string' || value === '' || (field.enumValues ?? []).includes(value)) continue;
    const fallback = field.enumValues?.[0] ?? '';
    nextSamples[field.id] = fallback;
    samplesChanged = true;
    adjustments.push(fallback
      ? `样例输入“${fieldLabel(field)}”的失效选项“${value}”已对齐为“${fallback}”`
      : `样例输入“${fieldLabel(field)}”的失效选项“${value}”已清空，请重新选择`);
  }
  if (samplesChanged) sampleInputs = nextSamples;
  if (!rulesChanged && !samplesChanged) return { snapshot: input, adjustments };
  return { snapshot: { ...input, rules, sampleInputs }, adjustments };
}

function reconcileCondition(
  condition: RuleCondition,
  fieldById: Map<string, RuleField>,
  rule: BusinessRule,
  adjustments: string[],
): RuleCondition {
  if (condition.kind === 'group') {
    let changed = false;
    const children = condition.conditions.map((child) => {
      const next = reconcileCondition(child, fieldById, rule, adjustments);
      if (next !== child) changed = true;
      return next;
    });
    return changed ? { ...condition, conditions: children } : condition;
  }
  const field = fieldById.get(condition.fieldId);
  if (!field || field.type !== 'enum' || typeof condition.value !== 'string') return condition;
  const options = field.enumValues ?? [];
  if (options.includes(condition.value)) return condition;
  const fallback = options[0];
  if (fallback === undefined) return condition;
  adjustments.push(`规则“${rule.name}”的“${fieldLabel(field)}”条件：失效选项“${condition.value}”已对齐为“${fallback}”`);
  return { ...condition, value: fallback };
}
