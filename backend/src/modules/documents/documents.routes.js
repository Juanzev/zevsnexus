// Central de Documentos (ARCHITECTURE §17.2): /documents, /trash, /folders, /document-types e /tags.
// Pipeline de recurso de tenant: authenticate → tenantContext (tenantRouter) → requirePermission →
// [rate limit] → validate → [Idempotency-Key] → controller.
import { requirePermission } from '../../middlewares/authorization.js';
import { idempotency } from '../../middlewares/idempotency.js';
import { tenantRouter } from '../../shared/tenant-router.js';
import { emptyBody, validate } from '../../shared/validation.js';
import * as controller from './documents.controller.js';
import {
  documentCreateBody,
  documentListQuery,
  documentMoveBody,
  documentPatchBody,
  downloadUrlBody,
  folderCreateBody,
  folderMoveBody,
  folderRenameBody,
  idParams,
  tagListQuery,
  trashListQuery,
  typeBody,
  typeListQuery,
  versionCreateBody,
  versionParams,
} from './documents.validator.js';

const VIEW = requirePermission('documents.view');
const MANAGE = requirePermission('documents.manage');

export function createDocumentsRouter({ limiters }) {
  const router = tenantRouter();

  router.get('/', VIEW, validate({ query: documentListQuery }), controller.list);
  router.post('/', MANAGE, validate({ body: documentCreateBody }), idempotency(), controller.create);
  router.get('/:id', VIEW, validate({ params: idParams }), controller.show);
  router.patch('/:id', MANAGE, validate({ params: idParams, body: documentPatchBody }), controller.update);
  router.delete('/:id', MANAGE, validate({ params: idParams, body: emptyBody }), controller.trash);
  router.get('/:id/history', VIEW, validate({ params: idParams }), controller.history);
  router.post('/:id/move', MANAGE, validate({ params: idParams, body: documentMoveBody }), controller.move);
  router.post(
    '/:id/versions',
    MANAGE,
    validate({ params: idParams, body: versionCreateBody }),
    idempotency(),
    controller.addVersion,
  );
  router.post(
    '/:id/versions/:number/restore',
    MANAGE,
    validate({ params: versionParams, body: emptyBody }),
    controller.restoreVersion,
  );
  router.post(
    '/:id/download-url',
    VIEW,
    limiters.downloadUrls,
    validate({ params: idParams, body: downloadUrlBody }),
    controller.downloadUrl,
  );
  router.post('/:id/archive', MANAGE, validate({ params: idParams, body: emptyBody }), controller.archive);
  router.post('/:id/unarchive', MANAGE, validate({ params: idParams, body: emptyBody }), controller.unarchive);
  router.put('/:id/favorite', VIEW, validate({ params: idParams, body: emptyBody }), controller.favorite);
  router.delete('/:id/favorite', VIEW, validate({ params: idParams, body: emptyBody }), controller.unfavorite);

  return router;
}

/** Lixeira: só quem gerencia documentos vê e restaura. */
export function createTrashRouter() {
  const router = tenantRouter();
  router.get('/', MANAGE, validate({ query: trashListQuery }), controller.listTrash);
  router.post('/:id/restore', MANAGE, validate({ params: idParams, body: emptyBody }), controller.restore);
  return router;
}

export function createFoldersRouter() {
  const router = tenantRouter();
  router.get('/', VIEW, validate({ query: emptyBody }), controller.listFolders);
  router.post('/', MANAGE, validate({ body: folderCreateBody }), controller.createFolder);
  router.get('/:id', VIEW, validate({ params: idParams }), controller.showFolder);
  router.patch('/:id', MANAGE, validate({ params: idParams, body: folderRenameBody }), controller.renameFolder);
  router.post('/:id/move', MANAGE, validate({ params: idParams, body: folderMoveBody }), controller.moveFolder);
  router.delete('/:id', MANAGE, validate({ params: idParams, body: emptyBody }), controller.deleteFolder);
  return router;
}

export function createDocumentTypesRouter() {
  const router = tenantRouter();
  router.get('/', VIEW, validate({ query: typeListQuery }), controller.listTypes);
  router.post('/', MANAGE, validate({ body: typeBody }), controller.createType);
  router.patch('/:id', MANAGE, validate({ params: idParams, body: typeBody }), controller.renameType);
  router.post('/:id/archive', MANAGE, validate({ params: idParams, body: emptyBody }), controller.archiveType);
  return router;
}

export function createTagsRouter() {
  const router = tenantRouter();
  router.get('/', VIEW, validate({ query: tagListQuery }), controller.listTags);
  return router;
}
