import { loadModelFile, loadProjectFile } from './actions';
import { importLandmarksFile } from './landmarkActions';

/** Dispatches a dropped / picked file to the right loader based on its extension. */
export async function openAnyFile(file: File): Promise<void> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.tffproj')) return loadProjectFile(file);
  if (name.endsWith('.json')) return importLandmarksFile(file);
  return loadModelFile(file); // reports unsupported formats itself
}
