import { useEffect, useState } from "react";
import { getMyPermissions, type MyPermissions } from "../api/permissions";

interface UsePermissionsResult {
  permissions: Set<string>;
  permissionLevelId: number | null;
  permissionLevelName: string | null;
  loading: boolean;
  can: (key: string) => boolean;
}

export function usePermissions(): UsePermissionsResult {
  const [data, setData] = useState<MyPermissions | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMyPermissions()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const permissions = new Set(data?.permissions ?? []);

  return {
    permissions,
    permissionLevelId: data?.permission_level_id ?? null,
    permissionLevelName: data?.permission_level_name ?? null,
    loading,
    can: (key: string) => permissions.has(key),
  };
}
