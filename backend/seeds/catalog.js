// Seed idempotente do catálogo (pág. 07): permissões, papéis, features e planos, por `code`.
// Pode rodar a cada deploy. Nunca apaga permissão nem feature (podem estar em uso);
// sincroniza o vínculo papel × permissão e plano × feature com o catálogo do código.
import { FEATURES, PLANS } from '../src/modules/plans/plans.catalog.js';
import { PERMISSIONS, ROLES } from '../src/modules/rbac/rbac.catalog.js';

export async function seedCatalog(db) {
  for (const permission of PERMISSIONS) {
    await db.query(
      `INSERT INTO permissions (code, description) VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description`,
      [permission.code, permission.description],
    );
  }

  for (const [index, role] of ROLES.entries()) {
    await db.query(
      `INSERT INTO roles (code, name, description, sort_order) VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name, description = EXCLUDED.description, sort_order = EXCLUDED.sort_order`,
      [role.code, role.name, role.description, index],
    );
    await db.query('DELETE FROM role_permissions WHERE role_code = $1 AND permission_code <> ALL($2::text[])', [
      role.code,
      role.permissions,
    ]);
    await db.query(
      `INSERT INTO role_permissions (role_code, permission_code)
       SELECT $1, code FROM unnest($2::text[]) AS code
       ON CONFLICT DO NOTHING`,
      [role.code, role.permissions],
    );
  }

  for (const feature of FEATURES) {
    await db.query(
      `INSERT INTO features (code, name, description) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`,
      [feature.code, feature.name, feature.description],
    );
  }

  // Um único plano padrão: desmarca os outros antes de gravar.
  const defaults = PLANS.filter((plan) => plan.isDefault).map((plan) => plan.code);
  await db.query('UPDATE plans SET is_default = false WHERE is_default AND code <> ALL($1::text[])', [defaults]);
  for (const plan of PLANS) {
    await db.query(
      `INSERT INTO plans (code, name, max_users, storage_quota_bytes, max_file_size_bytes, is_default)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name, max_users = EXCLUDED.max_users,
         storage_quota_bytes = EXCLUDED.storage_quota_bytes,
         max_file_size_bytes = EXCLUDED.max_file_size_bytes, is_default = EXCLUDED.is_default`,
      [plan.code, plan.name, plan.maxUsers, plan.storageQuotaBytes, plan.maxFileSizeBytes, plan.isDefault],
    );
    await db.query('DELETE FROM plan_features WHERE plan_code = $1 AND feature_code <> ALL($2::text[])', [
      plan.code,
      plan.features,
    ]);
    await db.query(
      `INSERT INTO plan_features (plan_code, feature_code)
       SELECT $1, code FROM unnest($2::text[]) AS code
       ON CONFLICT DO NOTHING`,
      [plan.code, plan.features],
    );
  }
}
