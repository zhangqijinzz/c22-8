import type { BusinessRule, PredicateCondition, RuleCondition, RuleField, SampleInput } from '../models/ruleModel';

export interface StaleEnumReference {
  ruleId: string;
  ruleName: string;
  fieldId: string;
  fieldName: string;
  /** 条件里仍然保存的、已经不在枚举选项中的旧值 */
  value: string;
  /** notEq 条件失效时会对所有输入意外成立，需要单独提示 */
  negated: boolean;
  /** 在条件树中的索引路径，长度为 1 表示规则顶层条件 */
  path: number[];
}

export interface StaleSampleValue {
  fieldId: string;
  fieldName: string;
  value: string;
}

/** 遍历条件树，对每个谓词条件回调（包含其索引路径） */
export function walkPredicates(
  condition: RuleCondition,
  path: number[],
  visit: (predicate: PredicateCondition, path: number[]) => void,
): void {
  if (condition.kind === 'group') {
    condition.conditions.forEach((child, index) => walkPredicates(child, [...path, index], visit));
    return;
  }
  visit(condition, path);
}

/**
 * 找出引用了枚举字段已失效选项的规则条件。
 * 字段选项被删除或改名后，条件保存的旧值不在新选项列表中，即判定为失效引用。
 */
export function findStaleEnumReferences(rules: BusinessRule[], fields: RuleField[]): StaleEnumReference[] {
  const fieldById = new Map(fields.map((field) => [field.id, field]));
  const stale: StaleEnumReference[] = [];
  for (const rule of rules) {
    walkPredicates(rule.conditions, [], (predicate, path) => {
      const field = fieldById.get(predicate.fieldId);
      if (
        field?.type === 'enum'
        && (predicate.operator === 'eq' || predicate.operator === 'notEq')
        && typeof predicate.value === 'string'
        && !(field.enumValues ?? []).includes(predicate.value)
      ) {
        stale.push({
          ruleId: rule.id,
          ruleName: rule.name,
          fieldId: field.id,
          fieldName: field.name,
          value: predicate.value,
          negated: predicate.operator === 'notEq',
          path,
        });
      }
    });
  }
  return stale;
}

/** 找出样例输入中保存的、已经不在枚举选项中的旧值 */
export function findStaleSampleValues(sampleInputs: SampleInput, fields: RuleField[]): StaleSampleValue[] {
  const stale: StaleSampleValue[] = [];
  for (const field of fields) {
    if (field.type !== 'enum') continue;
    const value = sampleInputs[field.id];
    if (typeof value === 'string' && value !== '' && !(field.enumValues ?? []).includes(value)) {
      stale.push({ fieldId: field.id, fieldName: field.name, value });
    }
  }
  return stale;
}

/** 对字段定义/规则/样例快照做引用完整性自检，用于版本记录等脱离当前项目定义的场景 */
export function summarizeReferenceIntegrity(
  fields: RuleField[],
  rules: BusinessRule[],
  sampleInputs: SampleInput = {},
): { staleConditionCount: number; staleSampleCount: number } {
  return {
    staleConditionCount: findStaleEnumReferences(rules, fields).length,
    staleSampleCount: findStaleSampleValues(sampleInputs, fields).length,
  };
}
