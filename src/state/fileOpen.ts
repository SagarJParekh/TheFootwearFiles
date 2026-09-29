import { loadStlFile } from './actions';
import { useStore } from './store';

/** Dispatches a dropped / picked file to the right loader based on its extension. */
export async function openAnyFile(file: File): Promise<void> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.stl')) return loadStlFile(file);
  useStore.setState({ error: `Unsupported file type: ${file.name}. Use .stl` });
}
