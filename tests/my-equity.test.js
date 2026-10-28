import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import equityRoutes from "../routes/esopRoutes.js";
import User from "../models/userModel.js";
import Employee from "../models/employeeModel.js";
import EquityGrant from "../models/esopModel.js";
import RevokedToken from "../models/revokedToken.js";
import subscriptionService from "../services/subscriptionService.js";
import vestingService from "../services/vestingService.js";

function request(headers = {}) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); },
    };
    equityRoutes.handle({ method: "GET", url: "/my-equity", headers }, res, reject);
  });
}

test("personal equity rejects unauthenticated requests before checking subscriptions", async (t) => {
  const subscription = t.mock.method(subscriptionService, "hasActiveSubscription", () => {
    throw new Error("Subscription must not run before authentication");
  });
  assert.equal((await request()).status, 401);
  assert.equal(subscription.mock.callCount(), 0);
});

test("personal equity reads company-scoped database grants for every role", async (t) => {
  const oldSecret = process.env.JWT_SECRET;
  const oldDisable = process.env.DISABLE_SUBSCRIPTION_CHECK;
  process.env.JWT_SECRET = "local-equity-regression-test";
  process.env.DISABLE_SUBSCRIPTION_CHECK = "false";
  t.after(() => {
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
    if (oldDisable === undefined) delete process.env.DISABLE_SUBSCRIPTION_CHECK;
    else process.env.DISABLE_SUBSCRIPTION_CHECK = oldDisable;
  });
  let role = "employee";
  let grants = [];
  t.mock.method(RevokedToken, "findOne", async () => null);
  t.mock.method(User, "findById", (id) => {
    assert.equal(id, "user-one");
    return { select: () => ({ populate: async () => ({
      _id: id, role, isActive: true,
      company: { _id: "company-one", isActive: true, isVerified: true },
      changedPasswordAfter: () => false,
    }) }) };
  });
  t.mock.method(subscriptionService, "hasActiveSubscription", async (company, module) => {
    assert.equal(company, "company-one");
    assert.equal(module, "esop");
    return true;
  });
  t.mock.method(Employee, "findOne", async (filter) => {
    assert.deepEqual(filter, { user: "user-one", company: "company-one" });
    return { _id: "employee-one" };
  });
  t.mock.method(EquityGrant, "find", (filter) => {
    assert.deepEqual(filter, {
      company: "company-one", employee: "employee-one",
      status: { $in: ["active", "fully_vested"] },
    });
    return { sort: () => ({ lean: async () => structuredClone(grants) }) };
  });
  const headers = { authorization: `Bearer ${jwt.sign({ id: "user-one" }, process.env.JWT_SECRET)}` };
  for (role of ["employee", "admin", "founder", "hr"]) {
    grants = [{ _id: "grant-one", totalShares: 100, sharesVested: 40, sharesExercised: 10, currentFMV: 250, vestingSchedule: [], status: "active" }];
    const result = await request(headers);
    assert.equal(result.status, 200);
    assert.equal(result.body.data.totalVested, 40);
    assert.equal(result.body.data.totalUnvested, 60);
    assert.equal(result.body.data.totalExercised, 10);
    assert.equal(result.body.data.grants[0].currentFMV, 250);
    grants = [];
    const empty = await request(headers);
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.data.grants, []);
    assert.equal(empty.body.data.totalGranted, 0);
  }
  role = "admin";
  grants = [{ _id: "legacy-grant", totalShares: 100, vestingSchedule: [], status: "active" }];
  const legacy = await request(headers);
  assert.equal(legacy.body.data.totalVested, 0);
  assert.equal(legacy.body.data.totalUnvested, 100);
  assert.equal(legacy.body.data.grants[0].sharesVested, 0);
  grants[0].vestingSchedule = [
    { isProcessed: true, sharesVested: 20 },
    { isProcessed: false, sharesVested: 80 },
  ];
  assert.equal((await request(headers)).body.data.totalVested, 20);
  grants[0].status = "fully_vested";
  assert.equal((await request(headers)).body.data.totalVested, 100);
});

test("grant schema retains vested shares and restores missing historical totals", () => {
  assert.equal(EquityGrant.schema.path("sharesVested").instance, "Number");
  const grant = EquityGrant.hydrate({ totalShares: 100, status: "active", vestingSchedule: [{ isProcessed: true, sharesVested: 20 }] });
  assert.equal(grant.sharesVested, 20);
  grant.sharesVested = 40;
  assert.equal(grant.toObject().sharesVested, 40);
});

test("company distribution aggregates issued shares including legacy grants", async (t) => {
  let grants = [
    { totalShares: 100, sharesVested: 50, employee: { _id: "one" }, status: "active" },
    { totalShares: 300, vestingSchedule: [{ isProcessed: true, sharesVested: 50 }], employee: { _id: "two" }, status: "active" },
  ];
  t.mock.method(EquityGrant, "find", (filter) => {
    assert.deepEqual(filter, { company: "company-one" });
    return { populate: () => ({ lean: async () => structuredClone(grants) }) };
  });
  const overview = await vestingService.getCompanyEquityOverview("company-one");
  assert.equal(overview.totalSharesGranted, 400);
  assert.equal(overview.totalSharesVested, 100);
  assert.equal(overview.totalSharesUnvested, 300);
  assert.equal(overview.totalSharesVested / overview.totalSharesGranted * 100, 25);
  assert.equal(overview.totalEmployeesWithEquity, 2);
  grants = [{ totalShares: 100, status: "fully_vested", employee: null }];
  assert.equal((await vestingService.getCompanyEquityOverview("company-one")).totalSharesVested, 100);
  grants = [];
  const empty = await vestingService.getCompanyEquityOverview("company-one");
  assert.equal(empty.totalSharesGranted, 0);
  assert.equal(empty.totalSharesVested, 0);
  assert.equal(empty.totalSharesUnvested, 0);
});
