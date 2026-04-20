/**
 * controlType — port of JsonParserService.DetermineControlType (C# line 42).
 *
 * The `type` field on each spec option decides what kind of input the
 * renderer-side UI should use. Without this mapping every option collapses
 * into a combo-box — which means free-typed lengths (전체길이, 탭길이) become
 * a single-value dropdown and the boolean 탭표시 becomes a dropdown with
 * ["false"] instead of a real checkbox.
 */
export type ControlKind =
  | 'COMBOBOX'
  | 'LISTBOX'
  | 'EDITBOX'
  | 'R_EDITBOX'
  | 'CHECKBOX'
  | 'RADIO';

export function determineControlType(t?: string): ControlKind {
  if (!t) return 'COMBOBOX';
  switch (t.trim().toUpperCase()) {
    case 'COMBO':
    case 'COMBOBOX':
      return 'COMBOBOX';
    case 'LISTBOX':
      return 'LISTBOX';
    case 'EDITBOX':
      return 'EDITBOX';
    case 'R_EDITBOX':
    case 'READONLYEDITBOX':
      return 'R_EDITBOX';
    case 'CHECKBOX':
      return 'CHECKBOX';
    case 'RADIO':
    case 'RADIOBUTTON':
    case 'RADIOGROUP':
      return 'RADIO';
    default:
      return 'COMBOBOX';
  }
}
