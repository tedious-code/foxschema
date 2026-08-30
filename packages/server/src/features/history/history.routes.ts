/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Schema history (Lokee) routes.
 *
 * Extracted verbatim from api/routes.ts; handler bodies are unchanged.
 */
import type { FastifyReply } from 'fastify';
import type { AppRequest } from '../../platform/http/types';
import { Router } from '../../platform/http/router';
import { requirePermissions } from '../authorization/rbac.guard';
import type { AuthedRequest } from '../auth/auth.routes';
import { rateLimit } from '../../platform/guards/rate-limit';
import type { ConnectionRef } from '../../platform/db/resolve';
import type { ConnectionOptions, MigrationModule } from '@foxschema/db';
import { sendError, sendThrown } from '../../platform/http/respond';

export interface HistoryRouteDeps {
  lokee: Record<string, any>;
  captureLiveSchema: (...args: any[]) => Promise<any>;
  resolveRef: (...args: any[]) => Promise<any>;
  migrationModule: MigrationModule;
}

export function createHistoryRoutes(deps: HistoryRouteDeps): Router {
  const router = Router();
  const lokeeCaptureLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });
  router.post(
    '/lokee/capture',
    lokeeCaptureLimiter,
    requirePermissions('schema.browse'),
    async (req: AppRequest, res: FastifyReply) => {
      const body = req.body as ConnectionRef & { source?: string; migrationRunId?: string };
      try {
        const resolved = await deps.resolveRef((req as AuthedRequest).userId, body);
        const result = await deps.captureLiveSchema(
          (req as AuthedRequest).userId!,
          resolved,
          body.source === 'migrate' || body.source === 'revert' ? body.source : 'manual',
          { migrationRunId: body.migrationRunId }
        );
        res.send(result);
      } catch (error: unknown) {
        sendThrown(res, error, 'Failed to capture schema');
      }
    }
  );

  router.get('/lokee/databases', async (req: AppRequest, res: FastifyReply) => {
    res.send({ databases: await deps.lokee.listDatabases((req as AuthedRequest).userId!) });
  });

  router.get('/lokee/databases/:id/versions', async (req: AppRequest, res: FastifyReply) => {
    const versions = await deps.lokee.listVersions(
      (req as AuthedRequest).userId!,
      String(req.params.id),
      Number(req.query.limit) || 100
    );
    res.send({ versions });
  });

  router.get('/lokee/databases/:id/graph', async (req: AppRequest, res: FastifyReply) => {
    // The store scopes every read to the caller, so an unknown or unowned id
    // returns an empty graph rather than another user's history.
    res.send(
      await deps.lokee.graph(
        (req as AuthedRequest).userId!,
        String(req.params.id),
        Number(req.query.limit) || 20
      )
    );
  });

  router.get(
    '/lokee/databases/:id/revert/plan',
    requirePermissions('schema.browse'),
    async (req: AppRequest, res: FastifyReply) => {
      const toVersionId = String(req.query.toVersionId ?? '').trim();
      if (!toVersionId) {
        sendError(res, 'invalid_input', 'toVersionId is required');
        return;
      }
      // Optional selective revert: `?objectKeys=a&objectKeys=b`, or omitted for
      // the whole schema.
      // Absent means "whole schema"; present-but-empty means "nothing", and
      // those must stay distinguishable all the way down.
      const objectKeys =
        req.query.objectKeys === undefined
          ? undefined
          : ([] as string[])
              .concat(req.query.objectKeys as string | string[])
              .map((k) => String(k).trim())
              .filter(Boolean);
      const plan = await deps.lokee.planRevert(
        (req as AuthedRequest).userId!,
        String(req.params.id),
        toVersionId,
        undefined,
        undefined,
        objectKeys
      );
      if (!plan) {
        sendError(res, 'not_found', 'Version not found');
        return;
      }
      const { steps: _steps, ...published } = plan;
      res.send(published);
    }
  );

  router.post(
    '/lokee/databases/:id/revert',
    lokeeCaptureLimiter,
    requirePermissions('schema.migrate'),
    async (req: AppRequest, res: FastifyReply) => {
      const body = req.body as ConnectionRef & {
        toVersionId?: string;
        confirmLossy?: boolean;
        /** Revert only these objects; omit for the whole schema. */
        objectKeys?: string[];
      };
      const toVersionId = String(body.toVersionId ?? '').trim();
      if (!toVersionId) {
        sendError(res, 'invalid_input', 'toVersionId is required');
        return;
      }
      let dialect: string;
      let option: ConnectionOptions;
      let schema: string;
      try {
        ({ dialect, option, schema } = await deps.resolveRef((req as AuthedRequest).userId, body));
      } catch (error: unknown) {
        sendError(res, 'invalid_input', error instanceof Error ? error.message : 'Invalid connection');
        return;
      }

      const userId = (req as AuthedRequest).userId!;
      const databaseId = String(req.params.id);
      // History is keyed by database identity; the execute connection must be
      // that same database or we would apply reverse DDL to the wrong target.
      const identityMatch = await deps.lokee.matchDatabaseIdentity(userId, databaseId, {
        dialect,
        host: option.host ?? null,
        port: option.port ?? null,
        database: option.database ?? null,
        schema: schema ?? null,
      });
      if (identityMatch === 'not_found') {
        sendError(res, 'not_found', 'Database not found');
        return;
      }
      if (identityMatch === 'mismatch') {
        sendError(res, 'conflict', 'The selected connection does not match this schema history. Choose the credential for the same database before reverting.');
        return;
      }

      /**
       * Snapshot the live schema before touching it.
       *
       * Two reasons, and the second is the one that matters. It leaves a
       * version to come back to — but it also makes the plan *correct*:
       * `planRevert` reverses from the newest **captured** version, not from
       * what is actually in the database. If someone changed the schema by
       * hand since the last capture, the reverse DDL was being computed against
       * a picture that no longer existed.
       *
       * So when this snapshot finds drift, the request is refused rather than
       * applied. The caller reviewed a plan built on the old head; running a
       * different one silently is exactly the surprise this is here to stop.
       */
      let preSnapshot: Awaited<ReturnType<HistoryRouteDeps['captureLiveSchema']>>;
      try {
        preSnapshot = await deps.captureLiveSchema(userId, { dialect, option, schema }, 'manual');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'snapshot failed';
        sendError(res, 'failed', `Could not snapshot the schema before reverting: ${message}`);
        return;
      }
      if (preSnapshot.changed) {
        res.status(409).send({
          ok: false,
          code: 'schema_drifted',
          error:
            `The live schema had changed since the last capture — snapshotted it as v${preSnapshot.versionNumber} ` +
            `(${preSnapshot.changeCount} object change(s)). Review the diff against that version and run the revert again.`,
          capture: preSnapshot,
        });
        return;
      }

      const objectKeys = Array.isArray(body.objectKeys)
        ? body.objectKeys.map((k) => String(k).trim()).filter(Boolean)
        : undefined;
      const plan = await deps.lokee.planRevert(
        userId,
        databaseId,
        toVersionId,
        dialect,
        schema,
        objectKeys
      );
      if (!plan) {
        sendError(res, 'not_found', 'Version not found');
        return;
      }
      const { steps, ...published } = plan;
      if (plan.alreadyAtTarget || steps.length === 0) {
        res.send({ ok: true, ...published, alreadyAtTarget: true });
        return;
      }
      if (plan.reversal.risk === 'blocked') {
        res.status(409).send({
          ok: false,
          error: 'This revert is blocked — existing data cannot be converted.',
          code: 'blocked',
          ...published,
        });
        return;
      }
      if (plan.reversal.risk === 'lossy' && body.confirmLossy !== true) {
        res.status(409).send({
          ok: false,
          error: 'This revert destroys data. Confirm to continue.',
          code: 'confirm_lossy',
          ...published,
        });
        return;
      }

      let failed = true;
      let executeError = 'Revert failed';
      try {
        await deps.migrationModule.execute(dialect, option, schema, steps, (event) => {
          if (event.type === 'done') {
            failed = !event.success;
            if (event.error) executeError = event.error;
          }
        });
      } catch (error: unknown) {
        failed = true;
        executeError = error instanceof Error ? error.message : 'Revert failed';
      }
      if (failed) {
        sendError(res, 'failed', executeError, { extra: published });
        return;
      }

      try {
        // Record where this undo came from and where it went, so reading the
        // history later answers "reverted to which version?" rather than just
        // "a revert happened".
        const capture = await deps.captureLiveSchema(userId, { dialect, option, schema }, 'revert', {
          revert: {
            fromVersionId: plan.fromVersion.id,
            toVersionId: plan.toVersion.id,
          },
        });
        res.send({ ok: true, capture, ...published });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'capture failed';
        sendError(res, 'failed', `Schema reverted but capture failed: ${message}`, {
          extra: published,
        });
      }
    }
  );

  router.patch(
    '/lokee/databases/:id/versions/:versionId',
    requirePermissions('schema.browse'),
    async (req: AppRequest, res: FastifyReply) => {
      const body = req.body as { name?: string | null; description?: string | null };
      const updated = await deps.lokee.updateVersionMeta(
        (req as AuthedRequest).userId!,
        String(req.params.id),
        String(req.params.versionId),
        {
          name: body.name,
          description: body.description,
        }
      );
      if (!updated) {
        sendError(res, 'not_found', 'Version not found');
        return;
      }
      res.send({ version: updated });
    }
  );

  router.get('/lokee/databases/:id/inspect', async (req: AppRequest, res: FastifyReply) => {
    const versionId = String(req.query.versionId ?? '').trim();
    const objectKey = String(req.query.objectKey ?? '').trim();
    if (!versionId || !objectKey) {
      sendError(res, 'invalid_input', 'versionId and objectKey are required');
      return;
    }
    const result = await deps.lokee.inspectObject(
      (req as AuthedRequest).userId!,
      String(req.params.id),
      versionId,
      objectKey
    );
    if (!result) {
      sendError(res, 'not_found', 'Object not found');
      return;
    }
    res.send(result);
  });

  router.get('/lokee/databases/:id/compare', async (req: AppRequest, res: FastifyReply) => {
    const versionId = String(req.query.versionId ?? '').trim();
    if (!versionId) {
      sendError(res, 'invalid_input', 'versionId is required');
      return;
    }
    const against = String(req.query.againstVersionId ?? '').trim();
    const result = await deps.lokee.diffVersions(
      (req as AuthedRequest).userId!,
      String(req.params.id),
      versionId,
      against || undefined
    );
    if (!result) {
      sendError(res, 'not_found', 'Version not found');
      return;
    }
    res.send(result);
  });

  return router;
}
