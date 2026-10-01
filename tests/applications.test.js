import test from "node:test";
import assert from "node:assert/strict";
import { validateApplication, validateApplicantQuery } from "../middlewares/applicationValidation.js";
import { submitApplication, getJobApplicants } from "../controllers/jobApplicationController.js";
import Job from "../models/jobModel.js";
import JobApplication from "../models/jobApplicationModel.js";

const id = "507f1f77bcf86cd799439011";
const response = () => ({
  statusCode: 200,
  set() { return this; },
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});
const body = {
  fullName: " Jane Applicant ", email: "Jane@Example.com", phone: "+234 800 123 4567",
  resumeName: "cv.pdf", resumeBase64: Buffer.from("%PDF-1.7\nexample").toString("base64"),
};

test("applicant pagination supplies defaults and rejects invalid limits", () => {
  const req = { query: {} };
  validateApplicantQuery(req, response(), () => {});
  assert.deepEqual(req.validated.query, { page: 1, limit: 20 });
  for (const query of [{ page: 0 }, { limit: 101 }, { page: "bad" }, { limit: 1.5 }, { email: "x" }]) {
    const res = response();
    validateApplicantQuery({ query }, res, () => assert.fail("Invalid query accepted"));
    assert.equal(res.statusCode, 400);
  }
});

test("applicant listing filters by job, excludes CV bytes and paginates newest first", async (t) => {
  t.mock.method(Job, "findById", (value) => {
    assert.equal(value, id);
    return { select: () => ({ lean: async () => ({ _id: id, title: "Engineer" }) }) };
  });
  const rows = [{ fullName: "Jane Applicant" }];
  const query = {
    select(fields) { assert.ok(!fields.split(" ").includes("resume")); return this; },
    sort(order) { assert.deepEqual(order, { createdAt: -1, _id: -1 }); return this; },
    skip(value) { assert.equal(value, 20); return this; },
    limit(value) { assert.equal(value, 20); return this; },
    async lean() { return rows; },
  };
  t.mock.method(JobApplication, "find", (filter) => { assert.deepEqual(filter, { job: id }); return query; });
  t.mock.method(JobApplication, "countDocuments", async (filter) => { assert.deepEqual(filter, { job: id }); return 21; });
  const res = response();
  await getJobApplicants({ validated: { params: { id }, query: { page: 2, limit: 20 } } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, rows);
  assert.equal(res.body.pagination.totalPages, 2);
});

test("applicant listing rejects nonexistent jobs", async (t) => {
  t.mock.method(Job, "findById", () => ({ select: () => ({ lean: async () => null }) }));
  t.mock.method(JobApplication, "find", () => assert.fail("Applicants should not be queried"));
  const res = response();
  await getJobApplicants({ validated: { params: { id }, query: { page: 1, limit: 20 } } }, res);
  assert.equal(res.statusCode, 404);
});

test("application validation normalizes details, decodes CV and preserves job ID", () => {
  const req = { body, validated: { params: { id } } };
  let passed = false;
  validateApplication(req, response(), () => { passed = true; });
  assert.ok(passed);
  assert.equal(req.validated.params.id, id);
  assert.equal(req.validated.body.email, "jane@example.com");
  assert.equal(req.validated.body.fullName, "Jane Applicant");
  assert.ok(Buffer.isBuffer(req.validated.body.resume));
  assert.equal(req.validated.body.resumeBase64, undefined);
});

test("application validation rejects missing details, injected status and invalid CVs", () => {
  for (const invalid of [
    {}, { ...body, email: "invalid" }, { ...body, status: "hired" },
    { ...body, resumeBase64: Buffer.from("not a PDF").toString("base64") },
    { ...body, resumeBase64: Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64") },
  ]) {
    const res = response();
    validateApplication({ body: invalid }, res, () => assert.fail("Invalid input accepted"));
    assert.equal(res.statusCode, 400);
  }
});

test("submission saves job-linked details and returns no private applicant data", async (t) => {
  t.mock.method(Job, "findById", () => ({ lean: async () => ({ _id: id, title: "Engineer" }) }));
  let stored;
  t.mock.method(JobApplication, "create", async (data) => { stored = data; return { _id: "application-id" }; });
  const req = { body, validated: { params: { id } } };
  validateApplication(req, response(), () => {});
  const res = response();
  await submitApplication(req, res);
  assert.equal(res.statusCode, 201);
  assert.equal(stored.job, id);
  assert.equal(stored.jobTitle, "Engineer");
  assert.deepEqual(res.body.data, { id: "application-id" });
});

test("missing jobs never create applications", async (t) => {
  t.mock.method(Job, "findById", () => ({ lean: async () => null }));
  t.mock.method(JobApplication, "create", () => assert.fail("Unexpected save"));
  const res = response();
  await submitApplication({ validated: { params: { id }, body: {} } }, res);
  assert.equal(res.statusCode, 404);
});

test("duplicate applications return success and database failures propagate", async (t) => {
  t.mock.method(Job, "findById", () => ({ lean: async () => ({ _id: id, title: "Engineer" }) }));
  let failure = Object.assign(new Error("Duplicate"), { code: 11000 });
  t.mock.method(JobApplication, "create", async () => { throw failure; });
  const req = { validated: { params: { id }, body: {} } };
  const res = response();
  await submitApplication(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.message, "Your application is submitted successfully, and we'll get back to you after review.");
  failure = new Error("Database unavailable");
  await assert.rejects(submitApplication(req, response()), /Database unavailable/);
});

test("uniqueness is scoped to job and normalized email, allowing different jobs", async (t) => {
  assert.ok(JobApplication.schema.indexes().some(([keys, options]) =>
    keys.job === 1 && keys.email === 1 && options.unique));
  assert.ok(!JobApplication.schema.indexes().some(([keys, options]) =>
    keys.email === 1 && !keys.job && options.unique));
  const stored = new Map();
  t.mock.method(Job, "findById", (jobId) => ({ lean: async () => ({ _id: jobId, title: "Engineer" }) }));
  t.mock.method(JobApplication, "create", async (data) => {
    const key = `${data.job}:${data.email}`;
    if (stored.has(key)) throw Object.assign(new Error("Duplicate"), { code: 11000 });
    stored.set(key, data);
    return { _id: key };
  });
  for (const [jobId, email, status] of [
    [id, "Jane@Example.com", 201],
    [id, " jane@example.com ", 200],
    ["507f1f77bcf86cd799439012", "jane@example.com", 201],
  ]) {
    const req = { body: { ...body, email }, validated: { params: { id: jobId } } };
    validateApplication(req, response(), () => {});
    const res = response();
    await submitApplication(req, res);
    assert.equal(res.statusCode, status);
    assert.equal(res.body.success, true);
  }
  assert.equal(stored.size, 2);
});
