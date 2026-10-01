import test from "node:test";
import assert from "node:assert/strict";
import Job from "../models/jobModel.js";
import controller from "../controllers/jobController.js";
import { validateJobBody, validateJobId } from "../middlewares/jobValidation.js";
import { protect, restrictTo } from "../middlewares/authMiddleware.js";

const job = { title: "Engineer", department: "Engineering", location: "Remote", type: "Full-time" };
const id = "507f1f77bcf86cd799439011";
const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("Joi rejects missing, empty, unknown and invalid job fields", () => {
  for (const body of [undefined, {}, { ...job, title: "  " }, { ...job, type: "Invalid" }, { ...job, role: "admin" }]) {
    const res = response();
    validateJobBody({ body }, res, () => assert.fail("Invalid input was accepted"));
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.errors.length);
  }
});

test("Joi trims values and supplies PUT description default", () => {
  const req = { body: { ...job, title: "  Engineer  " } };
  let called = false;
  validateJobBody(req, response(), () => { called = true; });
  assert.ok(called);
  assert.deepEqual(req.validated.body, { ...job, description: "" });
});

test("ID validation rejects malformed IDs", () => {
  const res = response();
  validateJobId({ params: { id: "invalid" } }, res, () => assert.fail("Invalid ID accepted"));
  assert.equal(res.statusCode, 400);
  let called = false;
  validateJobId({ params: { id } }, response(), () => { called = true; });
  assert.ok(called);
});

test("write guards reject anonymous and non-admin users", async () => {
  const res = response();
  await protect({ headers: {} }, res, () => assert.fail("Anonymous access allowed"));
  assert.equal(res.statusCode, 401);
  for (const role of ["founder", "hr", "employee"]) {
    const denied = response();
    restrictTo("admin")({ user: { role } }, denied, () => assert.fail("Non-admin access allowed"));
    assert.equal(denied.statusCode, 403);
  }
  let allowed = false;
  restrictTo("admin")({ user: { role: "admin" } }, response(), () => { allowed = true; });
  assert.ok(allowed);
});

test("public page uses database listings, including an empty collection", async (t) => {
  const rows = [{ ...job, _id: id }];
  t.mock.method(Job, "find", () => ({ sort: () => ({ lean: async () => rows }) }));
  const all = response();
  await controller.getAllJobs({}, all);
  assert.equal(all.body.count, 1);
  const page = response();
  await controller.getCareersContent({}, page);
  assert.deepEqual(page.body.data.jobs, rows);
  rows.length = 0;
  await controller.getCareersContent({}, page);
  assert.deepEqual(page.body.data.jobs, []);
});

test("create, single read, update and delete return saved data", async (t) => {
  const saved = { ...job, description: "", _id: id };
  const req = { validated: { params: { id }, body: { ...job, description: "" } } };
  t.mock.method(Job, "create", async (body) => { assert.deepEqual(body, req.validated.body); return saved; });
  t.mock.method(Job, "findById", (value) => { assert.equal(value, id); return { lean: async () => saved }; });
  t.mock.method(Job, "findByIdAndUpdate", async (value, update, options) => {
    assert.equal(value, id);
    assert.deepEqual(update, { $set: req.validated.body });
    assert.equal(options.runValidators, true);
    assert.equal(options.new, true);
    return saved;
  });
  t.mock.method(Job, "findByIdAndDelete", async (value) => { assert.equal(value, id); return saved; });
  const created = response();
  await controller.createJob(req, created);
  assert.equal(created.statusCode, 201);
  for (const action of [controller.getJobById, controller.updateJob]) {
    const res = response();
    await action(req, res);
    assert.deepEqual(res.body.data, saved);
  }
  const deleted = response();
  await controller.deleteJob(req, deleted);
  assert.deepEqual(deleted.body.data, { id });
});

test("single read, update and delete return 404 for missing jobs", async (t) => {
  t.mock.method(Job, "findById", () => ({ lean: async () => null }));
  t.mock.method(Job, "findByIdAndUpdate", async () => null);
  t.mock.method(Job, "findByIdAndDelete", async () => null);
  for (const action of [controller.getJobById, controller.updateJob, controller.deleteJob]) {
    const res = response();
    await action({ validated: { params: { id }, body: job } }, res);
    assert.equal(res.statusCode, 404);
  }
});
