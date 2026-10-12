import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { appPrisma, disconnectAll } from '../test-utils';
import { META, NOW, buildForms, db, makeUser, pendingRequest, setupFamily, validAnswers, validSignature } from './helpers';

function canonicalHash(value: unknown): string {
  const sort = (v: any): any => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
  return createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
}

describe('U4c forms: hash integrity', () => {
  let h: Awaited<ReturnType<typeof buildForms>>;
  let svc: any;
  beforeAll(async () => {
    h = await buildForms();
    svc = h.service;
  });
  afterAll(async () => {
    await disconnectAll();
  });

  describe('forms-hash module (pure functions)', () => {
    it('computeAnswersHash is a lowercase hex SHA-256 over key-sorted canonical JSON, including nested values', () => {
      const { computeAnswersHash } = h.hashMod();
      const a = { b: 1, a: { z: true, y: ['x', 2] }, c: null };
      const b = { c: null, a: { y: ['x', 2], z: true }, b: 1 };
      expect(computeAnswersHash(a)).toMatch(/^[0-9a-f]{64}$/);
      expect(computeAnswersHash(a)).toBe(computeAnswersHash(b));
      expect(computeAnswersHash(a)).toBe(canonicalHash(a));
      expect(computeAnswersHash(validAnswers())).toBe(canonicalHash(validAnswers()));
    });

    it('array order and value changes change the hash', () => {
      const { computeAnswersHash } = h.hashMod();
      expect(computeAnswersHash({ k: [1, 2] })).not.toBe(computeAnswersHash({ k: [2, 1] }));
      expect(computeAnswersHash({ k: 'a' })).not.toBe(computeAnswersHash({ k: 'b' }));
      expect(computeAnswersHash({ k: true })).not.toBe(computeAnswersHash({ k: 'true' }));
    });

    it('verifyAnswersHash accepts the matching answers and detects any tampering', () => {
      const { computeAnswersHash, verifyAnswersHash } = h.hashMod();
      const stored = computeAnswersHash(validAnswers());
      expect(verifyAnswersHash(validAnswers(), stored)).toBe(true);
      expect(verifyAnswersHash({ ...validAnswers(), swim_ok: false }, stored)).toBe(false);
      expect(verifyAnswersHash({ ...validAnswers(), extra: 1 }, stored)).toBe(false);
      const { full_name: _x, ...missing } = validAnswers();
      expect(verifyAnswersHash(missing, stored)).toBe(false);
      expect(verifyAnswersHash(validAnswers(), stored.replace(/^./, stored[0] === 'a' ? 'b' : 'a'))).toBe(false);
      expect(verifyAnswersHash(validAnswers(), '')).toBe(false);
    });
  });

  describe('service.verifySubmission', () => {
    it('reports valid for an untouched submission, for an admin of the centre', async () => {
      const f = await pendingRequest(svc, 'fh-valid');
      const sub = await svc.submitRequest(f.parent, f.req.id, { answers: validAnswers(), signature: validSignature() }, META, NOW);
      const out = await svc.verifySubmission(f.admin, sub.id);
      expect(out).toMatchObject({ submissionId: sub.id, valid: true, answersHash: sub.answersHash });
    });

    it('detects tampering when the stored answers no longer match the stored hash', async () => {
      const f = await pendingRequest(svc, 'fh-tamper');
      const sub = await svc.submitRequest(f.parent, f.req.id, { answers: validAnswers(), signature: validSignature() }, META, NOW);
      // The trigger blocks UPDATE, so simulate a privileged tamper by suspending user triggers inside one transaction.
      await db.$transaction([
        db.$executeRawUnsafe('SET LOCAL session_replication_role = replica'),
        db.$executeRawUnsafe(`UPDATE form_submissions SET answers = jsonb_set(answers, '{swim_ok}', 'false') WHERE id = '${sub.id}'`),
      ]);
      const out = await svc.verifySubmission(f.admin, sub.id);
      expect(out.valid).toBe(false);
    });

    it('is admin-only and centre-scoped', async () => {
      const f = await pendingRequest(svc, 'fh-access');
      const other = await setupFamily('fh-access-other');
      const sub = await svc.submitRequest(f.parent, f.req.id, { answers: validAnswers(), signature: validSignature() }, META, NOW);
      await expect(svc.verifySubmission(f.educator, sub.id)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.verifySubmission(f.parent, sub.id)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.verifySubmission(other.admin, sub.id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.verifySubmission(f.admin, '00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(NotFoundException);
      const orgAdmin = await makeUser(f.tenant, 'ORG_ADMIN');
      await expect(svc.verifySubmission(orgAdmin, sub.id)).resolves.toMatchObject({ valid: true });
    });
  });
});

describe('U4c forms: database-level immutability', () => {
  let h: Awaited<ReturnType<typeof buildForms>>;
  let svc: any;
  beforeAll(async () => {
    h = await buildForms();
    svc = h.service;
  });
  afterAll(async () => {
    await disconnectAll();
  });

  it('a submission row cannot be UPDATEd, even by the fixture superuser; DELETE is for the maintenance role only (trigger, OI-41)', async () => {
    const f = await pendingRequest(svc, 'fd-live');
    const sub = await svc.submitRequest(f.parent, f.req.id, { answers: validAnswers(), signature: validSignature() }, META, NOW);
    await expect(db.$executeRawUnsafe(`UPDATE form_submissions SET answers = '{}'::jsonb WHERE id = '${sub.id}'`)).rejects.toThrow();
    await expect(db.$executeRawUnsafe(`UPDATE form_submissions SET answers_hash = 'x' WHERE id = '${sub.id}'`)).rejects.toThrow();
    // The web API role can neither delete (no grant) nor, if it ever got the grant, pass the trigger.
    await expect(appPrisma.$executeRawUnsafe(`DELETE FROM form_submissions WHERE id = '${sub.id}'`)).rejects.toThrow();
    const row = await db.formSubmission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(row.answers).toEqual(validAnswers());
    // Retention purge runs as the maintenance role, which the trigger lets through.
    await expect(db.$executeRawUnsafe(`DELETE FROM form_submissions WHERE id = '${sub.id}'`)).resolves.toBeDefined();
  });

  it('a published template version row cannot be UPDATEd or DELETEd (trigger)', async () => {
    const f = await pendingRequest(svc, 'fd-version');
    await expect(db.$executeRawUnsafe(`UPDATE form_template_versions SET title = 'Hacked' WHERE template_id = '${f.templateId}'`)).rejects.toThrow();
    await expect(db.$executeRawUnsafe(`DELETE FROM form_template_versions WHERE template_id = '${f.templateId}'`)).rejects.toThrow();
  });

  describe('migration SQL text', () => {
    const dir = join(__dirname, '..', '..', 'prisma', 'migrations');
    const sql = (): string => {
      const names = existsSync(dir) ? readdirSync(dir).filter((n) => /u4c/i.test(n)) : [];
      return names.map((n) => readFileSync(join(dir, n, 'migration.sql'), 'utf8')).join('\n');
    };

    it('a u4c migration exists and creates the four forms tables with RLS', () => {
      const text = sql();
      for (const t of ['form_templates', 'form_template_versions', 'form_requests', 'form_submissions']) {
        expect(text).toMatch(new RegExp(`CREATE TABLE\\s+"?${t}"?`, 'i'));
        expect(text).toMatch(new RegExp(`ALTER TABLE\\s+"?${t}"?\\s+ENABLE ROW LEVEL SECURITY`, 'i'));
      }
    });

    it('form_submissions and form_template_versions have BEFORE UPDATE and BEFORE DELETE triggers that raise', () => {
      const text = sql();
      expect(text).toMatch(/CREATE TRIGGER[\s\S]*?BEFORE\s+(UPDATE\s+OR\s+DELETE|DELETE\s+OR\s+UPDATE|UPDATE)[\s\S]*?ON\s+"?form_submissions"?/i);
      expect(text).toMatch(/CREATE TRIGGER[\s\S]*?BEFORE\s+(UPDATE\s+OR\s+DELETE|DELETE\s+OR\s+UPDATE|UPDATE)[\s\S]*?ON\s+"?form_template_versions"?/i);
      expect(text).toMatch(/RAISE EXCEPTION/i);
      // If UPDATE and DELETE are separate triggers, DELETE must be covered too.
      expect(text).toMatch(/DELETE/i);
    });

    it('revokes UPDATE and DELETE on the immutable tables from the application role', () => {
      const text = sql();
      expect(text).toMatch(/REVOKE[^;]*\b(UPDATE|DELETE)\b[^;]*ON[^;]*form_submissions/i);
      expect(text).toMatch(/REVOKE[^;]*\b(UPDATE|DELETE)\b[^;]*ON[^;]*form_template_versions/i);
    });

    it('stores the audit evidence columns on form_submissions', () => {
      const text = sql();
      const block = /CREATE TABLE\s+"?form_submissions"?[\s\S]*?\);/i.exec(text)?.[0] ?? '';
      for (const col of ['answers', 'answers_hash', 'signed_at', 'ip', 'user_agent', 'template_version', 'supersedes_submission_id']) {
        expect(block).toMatch(new RegExp(`\\b${col}\\b`));
      }
    });
  });
});
