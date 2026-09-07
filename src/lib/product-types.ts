// Picklist for sales.product_type. Free `text` column, not a Postgres enum --
// same reasoning as appointment-types.ts: pre-picklist / imported free text
// keeps rendering as-is, only the picker is closed.
//
// Sorted alphabetically by label -- this is a picklist, not a workflow
// order, so A-Z is the least-surprising presentation.
export const PRODUCT_TYPES = [
  { value: 'critical_illness', label: 'Critical Illness' },
  { value: 'disability', label: 'Disability' },
  { value: 'other', label: 'Other' },
  { value: 'term_life', label: 'Term Life' },
  { value: 'universal_life', label: 'Universal Life' },
] as const;
