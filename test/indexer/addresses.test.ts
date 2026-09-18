import { describe, it, expect } from "vitest";
import { getAddresses, getAddress } from "../../src/indexer/addresses";
import { mockClient } from "./helpers";

const ADDRESS_DOC = { address: "5Fabc123", balance: "50000000000000000000" };

describe("getAddresses", () => {
  it("calls GET /api/addresses and returns raw array", async () => {
    const body = [ADDRESS_DOC, { address: "5Fxyz", balance: 100 }];
    const { client, requests } = mockClient(body);

    const result = await getAddresses(client);

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("/api/addresses");
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0].address).toBe("5Fabc123");
  });
});

describe("getAddress", () => {
  it("calls GET /api/address/:address and returns DataOnlyResponse", async () => {
    const body = { data: ADDRESS_DOC };
    const { client, requests } = mockClient(body);

    const result = await getAddress(client, "5Fabc123");

    expect(requests[0].url).toContain("/api/address/5Fabc123");
    expect(result.data.address).toBe("5Fabc123");
    expect((result as any).success).toBeUndefined();
  });

  it("URL-encodes the address parameter", async () => {
    const { client, requests } = mockClient({ data: ADDRESS_DOC });

    await getAddress(client, "addr with spaces");

    expect(requests[0].url).toContain("/api/address/addr%20with%20spaces");
  });
});
