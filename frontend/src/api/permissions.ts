import { api } from "./client";

export interface PermissionLevel {
  id: number;
  name: string;
  description: string | null;
  is_system: boolean;
  grants: string[];
  created_at: string;
}

export interface MyPermissions {
  permission_level_id: number | null;
  permission_level_name: string | null;
  permissions: string[];
}

export const ALL_PERMISSION_KEYS: string[] = [
  "colecao.criar",
  "colecao.editar",
  "colecao.excluir",
  "colecao.membros",
  "relatorio.publicar",
  "relatorio.editar",
  "relatorio.excluir",
  "visual.menu",
  "visual.exportar_csv",
  "assinatura.criar",
  "assinatura.gerenciar",
  "assinatura.executar",
  "admin.marca",
  "admin.usuarios",
  "admin.conexoes_pbi",
  "admin.email",
  "admin.autenticacao",
  "admin.auditoria",
  "admin.grupos",
  "admin.atualizacoes",
  "admin.niveis",
];

export const PERMISSION_LABELS: Record<string, string> = {
  "colecao.criar": "Criar colecoes",
  "colecao.editar": "Editar colecoes",
  "colecao.excluir": "Excluir colecoes",
  "colecao.membros": "Gerenciar membros de colecoes",
  "relatorio.publicar": "Publicar relatorios",
  "relatorio.editar": "Editar relatorios",
  "relatorio.excluir": "Excluir relatorios",
  "visual.menu": "Menu nativo dos visuais (modo foco, classificar, etc.)",
  "visual.exportar_csv": "Exportar dados de visuais em CSV",
  "assinatura.criar": "Criar assinaturas de e-mail",
  "assinatura.gerenciar": "Gerenciar assinaturas proprias",
  "assinatura.executar": "Executar assinaturas manualmente",
  "admin.marca": "Administracao > Marca",
  "admin.usuarios": "Administracao > Usuarios",
  "admin.conexoes_pbi": "Administracao > Conexoes Power BI",
  "admin.email": "Administracao > E-mail",
  "admin.autenticacao": "Administracao > Autenticacao",
  "admin.auditoria": "Administracao > Auditoria",
  "admin.grupos": "Administracao > Grupos",
  "admin.atualizacoes": "Administracao > Atualizacoes",
  "admin.niveis": "Administracao > Niveis de permissao",
};

export async function listPermissionLevels(): Promise<PermissionLevel[]> {
  const { data } = await api.get("/permissions/levels");
  return data;
}

export async function createPermissionLevel(input: { name: string; description?: string; grants: string[] }): Promise<PermissionLevel> {
  const { data } = await api.post("/permissions/levels", input);
  return data;
}

export async function updatePermissionLevel(
  id: number,
  input: { name?: string; description?: string; grants?: string[] },
): Promise<PermissionLevel> {
  const { data } = await api.put(`/permissions/levels/${id}`, input);
  return data;
}

export async function deletePermissionLevel(id: number): Promise<void> {
  await api.delete(`/permissions/levels/${id}`);
}

export async function assignPermissionLevel(userId: number, levelId: number | null): Promise<void> {
  await api.put(`/permissions/users/${userId}/level`, { permission_level_id: levelId });
}

export async function getMyPermissions(): Promise<MyPermissions> {
  const { data } = await api.get("/permissions/me");
  return data;
}
