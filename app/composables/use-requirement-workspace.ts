export function useRequirementWorkspace() {
  return useState('requirement-workspace', () => ({ id: '', locked: false, error: '' }))
}
