import { api } from "./client";

export interface RoleGrant {
  group_id: number | null;
  user_id: number | null;
  subject_name: string;
  subject_email: string | null;
  pbi_role: string;
}

export interface DatasetSecurity {
  dataset_id: number;
  name: string;
  pbi_workspace_name: string | null;
  requires_identity: boolean | null;
  rls_shared_by_roles: boolean | null;
  reports_count: number;
  /** Com ao menos uma funcao mapeada, o modelo passa a exigir funcao para abrir os relatorios dele */
  active: boolean;
  grants: RoleGrant[];
}

export interface RoleGrantInput {
  group_id?: number | null;
  user_id?: number | null;
  pbi_role: string;
}

export interface SecurityInput {
  rls_shared_by_roles: boolean | null;
  grants: RoleGrantInput[];
}

export async function getDatasetSecurity(datasetId: number): Promise<DatasetSecurity> {
  const { data } = await api.get(`/catalog/datasets/${datasetId}/security`);
  return data;
}

export async function saveDatasetSecurity(datasetId: number, input: SecurityInput): Promise<DatasetSecurity> {
  const { data } = await api.put(`/catalog/datasets/${datasetId}/security`, input);
  return data;
}

export async function testDatasetRole(datasetId: number, pbiRole: string): Promise<{ ok: boolean; message: string }> {
  const { data } = await api.post(`/catalog/datasets/${datasetId}/security/test`, { pbi_role: pbiRole });
  return data;
}
