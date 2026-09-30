/**
 * Mesh detail of the generated insole and footwear: how finely the surfaces are sampled (height
 * map grid), how round the lattice struts are and how densely straps and tubes are built. Higher
 * detail gives smoother surfaces and more triangles (bigger files, slower generation).
 */
export type MeshDetail = 'standard' | 'high' | 'ultra';

export const MESH_DETAIL: Record<MeshDetail, { label: string; grid: number; strutSides: number; surface: number }> = {
  standard: { label: 'Standard (1 mm grid)', grid: 1, strutSides: 6, surface: 1 },
  high: { label: 'High (0.5 mm grid, ~2–4× triangles)', grid: 0.5, strutSides: 10, surface: 2 },
  ultra: { label: 'Ultra (0.35 mm grid, ~4–8× triangles, slow)', grid: 0.35, strutSides: 14, surface: 3 },
};

export const MESH_DETAIL_LABEL = Object.fromEntries(Object.entries(MESH_DETAIL).map(([k, v]) => [k, v.label])) as Record<MeshDetail, string>;

export function normalizeDetail(v: unknown): MeshDetail {
  return v === 'high' || v === 'ultra' ? v : 'standard';
}
