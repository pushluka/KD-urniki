import { test } from "node:test";
import assert from "node:assert/strict";
import {
  establishRecovery,
  updateRecoveryPassword,
  passwordError,
  recoveryRedirect,
  isRecoveryLink,
} from "../lib/recovery.ts";
function authMock() {
  const calls = [];
  const user = { id: "user-1" };
  const session = { user };
  return {
    calls,
    setSession: async (v) => {
      calls.push(["setSession", v]);
      return { data: { session }, error: null };
    },
    verifyOtp: async (v) => {
      calls.push(["verifyOtp", v]);
      return { data: { session }, error: null };
    },
    exchangeCodeForSession: async () => ({
      data: { session, redirectType: "recovery" },
      error: null,
    }),
    getUser: async () => ({ data: { user }, error: null }),
    getSession: async () => ({ data: { session }, error: null }),
    updateUser: async (v) => {
      calls.push(["updateUser", v]);
      return { error: null };
    },
    signOut: async (v) => {
      calls.push(["signOut", v]);
      return { error: null };
    },
  };
}
test("production redirect uses the dedicated HTTPS recovery route", () => {
  assert.equal(
    recoveryRedirect("https://kd-urniki.vercel.app"),
    "https://kd-urniki.vercel.app/ponastavitev-gesla",
  );
  assert.equal(
    isRecoveryLink(
      new URL("https://kd-urniki.vercel.app/#type=recovery&access_token=test"),
    ),
    true,
  );
  assert.equal(isRecoveryLink(new URL("https://kd-urniki.vercel.app/")), false);
});
test("implicit recovery verifies the session with Auth before accepting it", async () => {
  const auth = authMock();
  assert.equal(
    await establishRecovery(
      auth,
      new URL(
        "https://example.com/#type=recovery&access_token=access&refresh_token=refresh",
      ),
    ),
    "user-1",
  );
  assert.deepEqual(auth.calls[0], [
    "setSession",
    { access_token: "access", refresh_token: "refresh" },
  ]);
});
test("token hash and recovery PKCE code are supported", async () => {
  const auth = authMock();
  assert.equal(
    await establishRecovery(
      auth,
      new URL("https://example.com/?type=recovery&token_hash=one-use"),
    ),
    "user-1",
  );
  assert.deepEqual(auth.calls[0], [
    "verifyOtp",
    { token_hash: "one-use", type: "recovery" },
  ]);
  assert.equal(
    await establishRecovery(auth, new URL("https://example.com/?code=code")),
    "user-1",
  );
});
test("missing, incomplete, expired and ordinary sign-in links are rejected", async () => {
  for (const suffix of [
    "",
    "#type=recovery&access_token=access",
    "#type=signup&access_token=a&refresh_token=r",
    "?error_code=otp_expired",
    "#error=access_denied",
  ]) {
    await assert.rejects(
      establishRecovery(authMock(), new URL("https://example.com/" + suffix)),
    );
  }
  const auth = authMock();
  auth.exchangeCodeForSession = async () => ({
    data: { session: { user: { id: "user-1" } }, redirectType: null },
    error: null,
  });
  await assert.rejects(
    establishRecovery(auth, new URL("https://example.com/?code=ordinary")),
  );
  auth.getUser = async () => ({
    data: { user: null },
    error: new Error("expired"),
  });
  await assert.rejects(
    establishRecovery(
      auth,
      new URL(
        "https://example.com/#type=recovery&access_token=a&refresh_token=r",
      ),
    ),
  );
});
test("password confirmation and minimum length are validated before Auth update", async () => {
  assert.ok(passwordError("short", "short"));
  assert.ok(passwordError("long-password", "different"));
  assert.equal(passwordError("long-password", "long-password"), null);
  const auth = authMock();
  await assert.rejects(
    updateRecoveryPassword(auth, "user-1", "short", "short"),
  );
  assert.equal(auth.calls.length, 0);
});
test("successful update uses Auth and signs out locally before returning to login", async () => {
  const auth = authMock();
  await updateRecoveryPassword(
    auth,
    "user-1",
    "new-password-123",
    "new-password-123",
  );
  assert.deepEqual(auth.calls, [
    ["updateUser", { password: "new-password-123" }],
    ["signOut", { scope: "local" }],
  ]);
});
test("expired or changed session cannot update password; failures never report success", async () => {
  const auth = authMock();
  await assert.rejects(
    updateRecoveryPassword(
      auth,
      "another-user",
      "new-password-123",
      "new-password-123",
    ),
  );
  assert.equal(auth.calls.length, 0);
  auth.getSession = async () => ({ data: { session: null }, error: null });
  await assert.rejects(
    updateRecoveryPassword(
      auth,
      "user-1",
      "new-password-123",
      "new-password-123",
    ),
  );
  const rejected = authMock();
  rejected.updateUser = async () => ({ error: new Error("weak password") });
  await assert.rejects(
    updateRecoveryPassword(
      rejected,
      "user-1",
      "new-password-123",
      "new-password-123",
    ),
  );
  assert.equal(rejected.calls.length, 0);
});
