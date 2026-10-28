import test from "node:test";
import assert from "node:assert/strict";
import controller from "../controllers/equityController.js";
import Employee from "../models/employeeModel.js";
import Grant from "../models/esopModel.js";

function response() {
  return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}

test("new grants default to pending until the employee responds", () => {
  const grant = new Grant({ totalShares: 100 });
  assert.equal(grant.status, "pending");
  assert.equal(grant.employeeDecision, undefined);
  assert.equal(grant.respondedAt, undefined);
  assert.equal(grant.sharesVested, 0);
});

test("both decisions require an explicit terms acknowledgement", async () => {
  for (const decision of ["accepted", "declined"]) {
    for (const termsAcknowledged of [undefined, false, "true"]) {
      const res = response();
      await controller.respondToGrant({ body: { decision, termsAcknowledged } }, res);
      assert.equal(res.code, 400);
    }
  }
});

test("decisions are scoped to the employee, company and pending status", async (t) => {
  t.mock.method(Employee, "findOne", async (query) => {
    assert.deepEqual(query, { user: "user-1", company: "company-1" });
    return { _id: "employee-1" };
  });
  let persisted = false;
  t.mock.method(Grant, "findOneAndUpdate", async (query, update) => {
    assert.deepEqual(query, { _id: "grant-1", employee: "employee-1", company: "company-1", status: "pending" });
    assert.equal(update.$set.status, "active");
    assert.equal(update.$set.employeeDecision, "accepted");
    assert.ok(update.$set.termsAcknowledgedAt instanceof Date);
    if (persisted) return null;
    persisted = true;
    return { _id: "grant-1", ...update.$set };
  });
  const req = { user: { id: "user-1", company: "company-1" }, params: { id: "grant-1" }, body: { decision: "accepted", termsAcknowledged: true } };
  const first = response();
  await controller.respondToGrant(req, first);
  assert.equal(first.code, 200);
  const second = response();
  await controller.respondToGrant(req, second);
  assert.equal(second.code, 409);
});

test("declining saves a non-vesting status", async (t) => {
  t.mock.method(Employee, "findOne", async () => ({ _id: "employee-1" }));
  t.mock.method(Grant, "findOneAndUpdate", async (_, update) => {
    assert.equal(update.$set.status, "declined");
    return { _id: "grant-1", ...update.$set };
  });
  const res = response();
  await controller.respondToGrant({ user: { id: "user-1", company: "company-1" }, params: { id: "grant-1" }, body: { decision: "declined", termsAcknowledged: true } }, res);
  assert.equal(res.body.data.employeeDecision, "declined");
});

test("grant details cannot be loaded without an employee record", async (t) => {
  t.mock.method(Employee, "findOne", async () => null);
  const res = response();
  await controller.getMyGrant({ user: { id: "outsider", company: "company-1" }, params: { id: "grant-1" } }, res);
  assert.equal(res.code, 404);
});
