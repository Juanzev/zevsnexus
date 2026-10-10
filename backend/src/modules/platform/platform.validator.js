import * as z from 'zod';
import { pagination, text, uuid } from '../../shared/validators.js';

export const listCompaniesQuery = z
  .object({
    status: z.enum(['pending', 'active', 'suspended']).optional(),
    q: text(100).optional(),
    ...pagination,
  })
  .strict();

export const companyParams = z.object({ id: uuid }).strict();

export const suspendBody = z.object({ reason: text(500, { min: 3, label: 'Motivo' }) }).strict();
