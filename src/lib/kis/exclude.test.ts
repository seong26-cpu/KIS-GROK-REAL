import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exclusionReason, isAdminName, isEtfName, isSpacName } from "./exclude.ts";

describe("exclusionReason", () => {
  it("drops ETF by name and by code list", () => {
    assert.equal(isEtfName("KODEX 200"), true);
    assert.equal(isEtfName("삼성전자"), false);
    assert.equal(exclusionReason({ code: "069500", name: "KODEX 200" }), "ETF/ETN");
    assert.equal(exclusionReason({ code: "069500", name: "코덱스", etfCodes: new Set(["069500"]) }), "ETF/ETN");
  });

  it("drops 관리 and 스팩/신규상장", () => {
    assert.equal(isAdminName("우리바이오(관리)"), true);
    assert.equal(isSpacName("엔에이치스팩31호"), true);
    assert.equal(exclusionReason({ code: "000000", name: "우리바이오(관리)" }), "관리");
    assert.equal(exclusionReason({ code: "111111", name: "엔에이치스팩31호" }), "신규상장");
    assert.equal(
      exclusionReason({ code: "123456", name: "새회사", newListedCodes: new Set(["123456"]) }),
      "신규상장",
    );
  });

  it("keeps ordinary stocks", () => {
    assert.equal(exclusionReason({ code: "005930", name: "삼성전자" }), null);
  });
});
