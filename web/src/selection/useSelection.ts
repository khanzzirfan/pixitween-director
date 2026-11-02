import { useCallback, useState } from 'react';
export interface EditSelection {
  sceneId?: string;
  layerId?: string;
}
export function useSelection() {
  const [selection, setSelection] = useState<EditSelection>();
  const select = useCallback((s: EditSelection) => setSelection(s), []);
  const clear = useCallback(() => setSelection(undefined), []);
  return { selection, select, clear };
}
