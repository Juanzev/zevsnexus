// HTTP da Central de Documentos: lê req.valid e o contexto, chama o service, responde.
import { requestContext } from '../../shared/request-context.js';
import * as catalogService from './catalog.service.js';
import * as documentsService from './documents.service.js';
import * as foldersService from './folders.service.js';

// ---------- documentos ----------

export async function list(req, res) {
  const { documents, meta } = await documentsService.listDocuments(requestContext(req), req.valid.query);
  res.json({ data: { documents }, meta });
}

export async function show(req, res) {
  res.json({ data: { document: await documentsService.getDocument(requestContext(req), req.valid.params.id) } });
}

export async function create(req, res) {
  const document = await documentsService.createDocument(requestContext(req), req.valid.body);
  res.status(201).json({ data: { document } });
}

export async function update(req, res) {
  const document = await documentsService.updateDocument(requestContext(req), req.valid.params.id, req.valid.body);
  res.json({ data: { document } });
}

export async function move(req, res) {
  const document = await documentsService.moveDocument(requestContext(req), req.valid.params.id, req.valid.body);
  res.json({ data: { document } });
}

export async function addVersion(req, res) {
  const document = await documentsService.addVersion(requestContext(req), req.valid.params.id, req.valid.body);
  res.status(201).json({ data: { document } });
}

export async function restoreVersion(req, res) {
  const { id, number } = req.valid.params;
  res.status(201).json({ data: { document: await documentsService.restoreVersion(requestContext(req), id, number) } });
}

export async function downloadUrl(req, res) {
  res.json({ data: await documentsService.createDownloadUrl(requestContext(req), req.valid.params.id, req.valid.body) });
}

export async function archive(req, res) {
  res.json({ data: { document: await documentsService.archiveDocument(requestContext(req), req.valid.params.id) } });
}

export async function unarchive(req, res) {
  res.json({ data: { document: await documentsService.unarchiveDocument(requestContext(req), req.valid.params.id) } });
}

export async function trash(req, res) {
  await documentsService.trashDocument(requestContext(req), req.valid.params.id);
  res.status(204).end();
}

export async function favorite(req, res) {
  await documentsService.setFavorite(requestContext(req), req.valid.params.id, true);
  res.status(204).end();
}

export async function unfavorite(req, res) {
  await documentsService.setFavorite(requestContext(req), req.valid.params.id, false);
  res.status(204).end();
}

export async function history(req, res) {
  res.json({ data: { events: await documentsService.getHistory(requestContext(req), req.valid.params.id) } });
}

// ---------- lixeira ----------

export async function listTrash(req, res) {
  const { documents, meta } = await documentsService.listDocuments(requestContext(req), req.valid.query, { trash: true });
  res.json({ data: { documents }, meta });
}

export async function restore(req, res) {
  res.json({ data: { document: await documentsService.restoreDocument(requestContext(req), req.valid.params.id) } });
}

// ---------- pastas ----------

export async function listFolders(req, res) {
  res.json({ data: { folders: await foldersService.listFolders(requestContext(req)) } });
}

export async function showFolder(req, res) {
  res.json({ data: { folder: await foldersService.getFolder(requestContext(req), req.valid.params.id) } });
}

export async function createFolder(req, res) {
  res.status(201).json({ data: { folder: await foldersService.createFolder(requestContext(req), req.valid.body) } });
}

export async function renameFolder(req, res) {
  const folder = await foldersService.renameFolder(requestContext(req), req.valid.params.id, req.valid.body);
  res.json({ data: { folder } });
}

export async function moveFolder(req, res) {
  const folder = await foldersService.moveFolder(requestContext(req), req.valid.params.id, req.valid.body);
  res.json({ data: { folder } });
}

export async function deleteFolder(req, res) {
  await foldersService.deleteFolder(requestContext(req), req.valid.params.id);
  res.status(204).end();
}

// ---------- tipos e tags ----------

export async function listTypes(req, res) {
  res.json({ data: { document_types: await catalogService.listTypes(requestContext(req), req.valid.query) } });
}

export async function createType(req, res) {
  res.status(201).json({ data: { document_type: await catalogService.createType(requestContext(req), req.valid.body) } });
}

export async function renameType(req, res) {
  const type = await catalogService.renameType(requestContext(req), req.valid.params.id, req.valid.body);
  res.json({ data: { document_type: type } });
}

export async function archiveType(req, res) {
  res.json({ data: { document_type: await catalogService.archiveType(requestContext(req), req.valid.params.id) } });
}

export async function listTags(req, res) {
  res.json({ data: { tags: await catalogService.searchTags(requestContext(req), req.valid.query) } });
}
