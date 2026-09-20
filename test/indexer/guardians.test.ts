import { describe, it, expect } from "vitest";
import { getGuardianGroups, getGuardianGroup, getGuardians, getGuardian } from "../../src/indexer/guardians";
import { mockClient } from "./helpers";

const GROUP_DOC = {
  groupId: "0xgroup1",
  guardians: ["5Fa", "5Fb", "5Fc"],
  guardianNames: ["Alice", null, "Carol"],
};

describe("getGuardianGroups", () => {
  it("calls GET /api/guardian-groups and returns data", async () => {
    const body = { success: true, data: [GROUP_DOC] };
    const { client, requests } = mockClient(body);

    const result = await getGuardianGroups(client);

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("/api/guardian-groups");
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].groupId).toBe("0xgroup1");
    expect(result.data[0].guardianNames).toEqual(["Alice", null, "Carol"]);
  });

  it("passes guardian query filter", async () => {
    const { client, requests } = mockClient({ success: true, data: [] });

    await getGuardianGroups(client, { guardian: "5FguardAddr" });

    const url = new URL(requests[0].url);
    expect(url.searchParams.get("guardian")).toBe("5FguardAddr");
  });

  it("sends no query params when called without filter", async () => {
    const { client, requests } = mockClient({ success: true, data: [] });

    await getGuardianGroups(client);

    const url = new URL(requests[0].url);
    expect(url.search).toBe("");
  });
});

describe("getGuardians", () => {
  it("flattens groups into unique { account, displayName } records", async () => {
    const { client } = mockClient({
      success: true,
      data: [
        GROUP_DOC,
        {
          groupId: "0xgroup2",
          guardians: ["5Fa", "5Fd"],
          guardianNames: ["Alice", "Dave"],
        },
      ],
    });

    const result = await getGuardians(client);

    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      { account: "5Fa", displayName: "Alice" },
      { account: "5Fb", displayName: null },
      { account: "5Fc", displayName: "Carol" },
      { account: "5Fd", displayName: "Dave" },
    ]);
  });

  it("returns an empty list when no guardian groups exist", async () => {
    const { client } = mockClient(
      { success: false, message: "No guardian groups found" },
      { ok: false, status: 404, statusText: "Not Found" },
    );

    const result = await getGuardians(client);

    expect(result.data).toEqual([]);
  });
});

describe("getGuardian", () => {
  it("filters by account and returns { account, displayName }", async () => {
    const { client, requests } = mockClient({ success: true, data: [GROUP_DOC] });

    const result = await getGuardian(client, "5Fc");

    const url = new URL(requests[0].url);
    expect(url.pathname).toBe("/api/guardian-groups");
    expect(url.searchParams.get("guardian")).toBe("5Fc");
    expect(result.data).toEqual({ account: "5Fc", displayName: "Carol" });
  });

  it("returns null displayName when the account has no identity", async () => {
    const { client } = mockClient({ success: true, data: [GROUP_DOC] });

    const result = await getGuardian(client, "5Fb");

    expect(result.data).toEqual({ account: "5Fb", displayName: null });
  });

  it("returns null displayName when no groups match", async () => {
    const { client } = mockClient(
      { success: false, message: "No guardian groups found" },
      { ok: false, status: 404, statusText: "Not Found" },
    );

    const result = await getGuardian(client, "5Fmissing");

    expect(result.data).toEqual({ account: "5Fmissing", displayName: null });
  });
});

describe("getGuardianGroup", () => {
  it("calls GET /api/guardian-group/:id", async () => {
    const body = { success: true, data: GROUP_DOC };
    const { client, requests } = mockClient(body);

    const result = await getGuardianGroup(client, "0xgroup1");

    expect(requests[0].url).toContain("/api/guardian-group/0xgroup1");
    expect(result.data.groupId).toBe("0xgroup1");
  });

  it("URL-encodes the id parameter", async () => {
    const { client, requests } = mockClient({ success: true, data: GROUP_DOC });

    await getGuardianGroup(client, "id/special");

    expect(requests[0].url).toContain("/api/guardian-group/id%2Fspecial");
  });
});
