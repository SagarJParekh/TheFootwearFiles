import { loadProjectFile, loadStlFile } from './actions';
import { useStore } from './store';
import { importLandmarksFile } from './landmarkActions';

/** Dispatches a dropped / picked file to the right loader based on its extension. */
export async function openAnyFile(file: File): Promise<void> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.stl')) return loadStlFile(file);
  if (name.endsWith('.tffproj')) return loadProjectFile(file);
  if (name.endsWith('.json')) return importLandmarksFile(file);
  useStore.setState({ error: `Unsupported file type: ${file.name}. Use .stl, .tffproj or landmarks .json` });
}
