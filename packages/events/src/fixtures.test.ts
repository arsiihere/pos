import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseEvent } from "./codecs";
import "./index";
import { payloadSchema } from "./registry";

describe("fixtures", () => {
  it("[F §6.7, D46] every stored fixture upcasts to its .latest.json", () => {
    const dir = fileURLToPath(new URL("../fixtures/", import.meta.url));
    const versioned = readdirSync(dir)
      .map((name) => /^(\w+)\.v(\d+)\.json$/.exec(name))
      .filter((match) => match !== null)
      .map((match) => ({
        name: match[0],
        type: match[1]!,
        version: Number(match[2]),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(versioned).toHaveLength(25);
    for (const { name, type } of versioned) {
      const stored = JSON.parse(
        readFileSync(join(dir, name), "utf8"),
      ) as unknown;
      const latest = JSON.parse(
        readFileSync(join(dir, `${type}.latest.json`), "utf8"),
      ) as { schema_version: number };
      expect(parseEvent(stored), name).toEqual(latest);
      // one sample per schema version: v1 … latest, none missing
      const versions = versioned
        .filter((fixture) => fixture.type === type)
        .map((fixture) => fixture.version);
      expect(
        versions.sort((a, b) => a - b),
        type,
      ).toEqual(
        Array.from({ length: latest.schema_version }, (_, index) => index + 1),
      );
    }
  });

  it("[01b #64] a stored v1 StaffDirectoryApplied payload upcasts to an equal v2 payload; v2 adds the lead and responsibility skip kinds", () => {
    const dir = fileURLToPath(new URL("../fixtures/", import.meta.url));
    const v1 = JSON.parse(
      readFileSync(join(dir, "StaffDirectoryApplied.v1.json"), "utf8"),
    ) as {
      schema_version: number;
      payload: Record<string, unknown>;
    };
    const stored = {
      ...v1,
      payload: {
        ...v1.payload,
        skipped: [{ kind: "approver", id: "R1", reason: "unknown_role" }],
      },
    };
    const upcast = parseEvent(stored);
    expect(upcast.schema_version).toBe(2);
    expect(upcast.payload).toEqual(stored.payload);

    const v2 = payloadSchema("StaffDirectoryApplied", 2);
    const v1Schema = payloadSchema("StaffDirectoryApplied", 1);
    for (const kind of ["lead", "responsibility"]) {
      const payload = {
        ...v1.payload,
        skipped: [{ kind, id: "S1", reason: "staff_not_sent" }],
      };
      expect(v2.safeParse(payload).success, kind).toBe(true);
      expect(v1Schema.safeParse(payload).success, kind).toBe(false);
    }
  });

  it("[00 §4.2] DevicePaired requires exactly one pairing source id", () => {
    const schema = payloadSchema("DevicePaired", 1);
    const base = {
      device_id: "d",
      device_name: "n",
      device_type: "kds",
      station_id: "st",
      owner_staff_id: null,
    };
    expect(
      schema.safeParse({
        ...base,
        pairing_token_id: "t",
        pairing_request_id: null,
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        ...base,
        pairing_token_id: null,
        pairing_request_id: "r",
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        ...base,
        pairing_token_id: null,
        pairing_request_id: null,
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...base,
        pairing_token_id: "t",
        pairing_request_id: "r",
      }).success,
    ).toBe(false);
  });

  it("[00 §4.2] AdminBootstrapTokenIssued requires issued_by", () => {
    const schema = payloadSchema("AdminBootstrapTokenIssued", 1);
    const base = {
      bootstrap_token_id: "b",
      expires_at: 1,
      issued_by: "setup" as const,
    };
    expect(schema.safeParse(base).success).toBe(true);
    expect(
      schema.safeParse({ bootstrap_token_id: "b", expires_at: 1 }).success,
    ).toBe(false);
    expect(schema.safeParse({ ...base, issued_by: "cli" }).success).toBe(true);
    expect(schema.safeParse({ ...base, issued_by: "restore" }).success).toBe(
      true,
    );
    expect(schema.safeParse({ ...base, issued_by: "owner" }).success).toBe(
      false,
    );
  });

  it("[01c #66] StockSet.v1.json and StockAdded.v1.json upcast to their .latest.json with stock_item_id = item_id; BusinessDayOpened.v1.json upcasts to its .latest.json", () => {
    const dir = fileURLToPath(new URL("../fixtures/", import.meta.url));
    for (const type of ["StockSet", "StockAdded"]) {
      const v1 = JSON.parse(
        readFileSync(join(dir, `${type}.v1.json`), "utf8"),
      ) as { payload: { item_id: string } };
      const latest = JSON.parse(
        readFileSync(join(dir, `${type}.latest.json`), "utf8"),
      ) as { schema_version: number };
      const upcast = parseEvent(v1);
      expect(upcast, type).toEqual(latest);
      expect(upcast.schema_version, type).toBe(2);
      expect(upcast.payload, type).toMatchObject({
        stock_item_id: v1.payload.item_id,
      });
      expect(upcast.payload, type).not.toHaveProperty("item_id");
    }
    // §5.3 row 3: stock_units[k] = stock_unit; draws[k] = one draw from stock item k.
    const dayV1 = JSON.parse(
      readFileSync(join(dir, "BusinessDayOpened.v1.json"), "utf8"),
    ) as {
      payload: {
        units: Record<string, { stock_unit: string; sale_unit: string; stock_per_sale_unit: number }>;
      };
    };
    const dayLatest = JSON.parse(
      readFileSync(join(dir, "BusinessDayOpened.latest.json"), "utf8"),
    ) as { schema_version: number };
    const day = parseEvent(dayV1);
    expect(day).toEqual(dayLatest);
    expect(day.schema_version).toBe(2);
    const [[k, units]] = Object.entries(dayV1.payload.units) as [[string, { stock_unit: string; sale_unit: string; stock_per_sale_unit: number }]];
    expect(day.payload).toEqual({
      business_date: "2025-10-20",
      stock_units: { [k]: units.stock_unit },
      draws: {
        [k]: {
          sale_unit: units.sale_unit,
          stock_draws: [{ stock_item_id: k, quantity_per_sale_unit: units.stock_per_sale_unit }],
        },
      },
    });
  });

  it("[01c §6.20] BusinessDayOpened v2 accepts empty stock_units and draws; rejects a draw with quantity_per_sale_unit 0, an unknown unit and a bad date", () => {
    const schema = payloadSchema("BusinessDayOpened", 2);
    const draw = { stock_item_id: "K1", quantity_per_sale_unit: 500 };
    const ok = { business_date: "2026-10-25", stock_units: { K1: "g" }, draws: { I1: { sale_unit: "piece", stock_draws: [draw] } } };
    expect(schema.safeParse(ok).success).toBe(true);
    expect(schema.safeParse({ business_date: "2026-10-25", stock_units: {}, draws: {} }).success).toBe(true);
    expect(schema.safeParse({ ...ok, draws: { I1: { sale_unit: "piece", stock_draws: [] } } }).success).toBe(true);
    expect(schema.safeParse({ ...ok, draws: { I1: { sale_unit: "piece", stock_draws: [{ ...draw, quantity_per_sale_unit: 0 }] } } }).success).toBe(false);
    expect(schema.safeParse({ ...ok, stock_units: { K1: "kg" } }).success).toBe(false);
    expect(schema.safeParse({ ...ok, business_date: "25-10-2026" }).success).toBe(false);
  });

  it("[01a §4.2] StockSet rejects on_hand 1000001 and -1; StockAdded rejects quantity 0", () => {
    const set = payloadSchema("StockSet", 2);
    expect(
      set.safeParse({ stock_item_id: "i", on_hand: 1_000_000, unit: "piece" })
        .success,
    ).toBe(true);
    expect(
      set.safeParse({ stock_item_id: "i", on_hand: 0, unit: "piece" }).success,
    ).toBe(true);
    expect(
      set.safeParse({ stock_item_id: "i", on_hand: 1_000_001, unit: "piece" })
        .success,
    ).toBe(false);
    expect(
      set.safeParse({ stock_item_id: "i", on_hand: -1, unit: "piece" }).success,
    ).toBe(false);
    const added = payloadSchema("StockAdded", 2);
    expect(
      added.safeParse({ stock_item_id: "i", quantity: 1, unit: "g" }).success,
    ).toBe(true);
    expect(
      added.safeParse({ stock_item_id: "i", quantity: 1_000_000, unit: "g" }).success,
    ).toBe(true);
    expect(
      added.safeParse({ stock_item_id: "i", quantity: 0, unit: "g" }).success,
    ).toBe(false);
    expect(
      added.safeParse({ stock_item_id: "i", quantity: 1_000_001, unit: "g" }).success,
    ).toBe(false);
  });

  it("[01a §4.2] StockSet and StockAdded require unit", () => {
    expect(
      payloadSchema("StockSet", 2).safeParse({ stock_item_id: "i", on_hand: 1 })
        .success,
    ).toBe(false);
    expect(
      payloadSchema("StockAdded", 2).safeParse({ stock_item_id: "i", quantity: 1 })
        .success,
    ).toBe(false);
    expect(
      payloadSchema("StockSet", 2).safeParse({
        stock_item_id: "i",
        on_hand: 1,
        unit: "kg",
      }).success,
    ).toBe(false);
  });

  it('[01a §4.2] BusinessDayOpened rejects "25-10-2026"', () => {
    const schema = payloadSchema("BusinessDayOpened", 1);
    const units = {
      i: { stock_unit: "g", sale_unit: "piece", stock_per_sale_unit: 250 },
    };
    expect(
      schema.safeParse({ business_date: "2026-10-25", units }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ business_date: "25-10-2026", units }).success,
    ).toBe(false);
    expect(schema.safeParse({ business_date: "2026-10-25" }).success).toBe(
      false,
    );
  });

  it("[01a §4.2] BranchConfigApplied has no epoch fields", () => {
    const schema = payloadSchema("BranchConfigApplied", 1);
    const payload = {
      config_version: 43,
      snapshot_schema_version: 1,
      snapshot_hash: "a".repeat(64),
      previous_config_version: 42,
    };
    const parsed = schema.parse({
      ...payload,
      config_epoch: 7,
      previous_config_epoch: 6,
    });
    expect(parsed).toEqual(payload);
    expect(
      schema.safeParse({ ...payload, previous_config_version: null }).success,
    ).toBe(true);
    expect(schema.safeParse({ ...payload, snapshot_hash: "xyz" }).success).toBe(
      false,
    );
  });

  it("[01a §4.2] BusinessDayClosed, ItemMadeUnavailable and ItemMadeAvailable payloads", () => {
    expect(payloadSchema("BusinessDayClosed", 1).safeParse({}).success).toBe(
      true,
    );
    expect(
      payloadSchema("ItemMadeUnavailable", 1).safeParse({ item_id: "i" })
        .success,
    ).toBe(true);
    expect(payloadSchema("ItemMadeAvailable", 1).safeParse({}).success).toBe(
      false,
    );
  });
});
