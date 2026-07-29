export type LoopbaseSkuType = 'standard' | 'parent_child' | 'composite' | 'digital'

export const SKU_TYPE_OPTIONS: Array<{
  value: LoopbaseSkuType
  label: string
  description: string
}> = [
  {
    value: 'standard',
    label: 'Standard',
    description: 'Normal stocked SKU with its own quantity.',
  },
  {
    value: 'parent_child',
    label: 'Parent / Child',
    description: 'Variation parent. Add child SKUs on the edit page.',
  },
  {
    value: 'composite',
    label: 'Composite',
    description: 'Bundle made from existing standard SKUs.',
  },
  {
    value: 'digital',
    label: 'Digital',
    description: 'Untracked inventory for digital or unlimited items.',
  },
]

export function cleanSkuType(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

export function normaliseSkuType(value: unknown): LoopbaseSkuType {
  const clean = cleanSkuType(value)

  if (clean === 'parent' || clean === 'parent_child') return 'parent_child'
  if (clean === 'composite') return 'composite'
  if (clean === 'digital') return 'digital'

  return 'standard'
}

export function skuTypeLabel(value: unknown) {
  const normalised = normaliseSkuType(value)
  return SKU_TYPE_OPTIONS.find((option) => option.value === normalised)?.label || 'Standard'
}

export function isQuantityTrackedSkuType(value: unknown) {
  const clean = cleanSkuType(value)
  return clean === 'standard' || clean === 'reusable' || clean === 'single_use'
}

export function isDigitalSkuType(value: unknown) {
  return normaliseSkuType(value) === 'digital'
}

export function isCompositeSkuType(value: unknown) {
  return normaliseSkuType(value) === 'composite'
}

export function isParentChildSkuType(value: unknown) {
  return normaliseSkuType(value) === 'parent_child'
}
