import { describe, it, expect, beforeEach } from "vitest";
import { stringUtf8CV, uintCV, principalCV, listCV, stringAsciiCV, noneCV, someCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_TITLE = 101;
const ERR_INVALID_DESCRIPTION = 102;
const ERR_INVALID_TAGS = 103;
const ERR_INVALID_URGENCY = 104;
const ERR_INVALID_EVIDENCE_HASH = 105;
const ERR_INVALID_STATUS = 106;
const ERR_COMPLAINT_ALREADY_EXISTS = 107;
const ERR_COMPLAINT_NOT_FOUND = 108;
const ERR_AUTHORITY_NOT_VERIFIED = 110;
const ERR_COMPLAINT_UPDATE_NOT_ALLOWED = 112;
const ERR_INVALID_UPDATE_PARAM = 113;
const ERR_MAX_COMPLAINTS_EXCEEDED = 114;
const ERR_INVALID_CATEGORY = 115;
const ERR_INVALID_COST_ESTIMATE = 116;

interface Complaint {
  title: string;
  description: string;
  tags: string[];
  urgency: number;
  evidenceHash: string;
  category: string;
  costEstimate: number;
  timestamp: number;
  complainant: string;
  status: string;
  matchedProvider: string | null;
  resolutionHash: string | null;
}

interface ComplaintUpdate {
  updateTitle: string;
  updateDescription: string;
  updateTags: string[];
  updateTimestamp: number;
  updater: string;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class ComplaintRegistryMock {
  state: {
    nextComplaintId: number;
    maxComplaints: number;
    submissionFee: number;
    authorityContract: string | null;
    complaints: Map<number, Complaint>;
    complaintsByTitle: Map<string, number>;
    complaintUpdates: Map<number, ComplaintUpdate>;
    complaintsByComplainant: Map<string, number[]>;
    complaintsByCategory: Map<string, number[]>;
  } = {
    nextComplaintId: 0,
    maxComplaints: 1000,
    submissionFee: 500,
    authorityContract: null,
    complaints: new Map(),
    complaintsByTitle: new Map(),
    complaintUpdates: new Map(),
    complaintsByComplainant: new Map(),
    complaintsByCategory: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1PQHQKV0RJXZHJ1DG7E4MCRHU6EQ5XACP187S9";
  authorities: Set<string> = new Set(["ST1PQHQKV0RJXZHJ1DG7E4MCRHU6EQ5XACP187S9"]);
  stxTransfers: Array<{ amount: number; from: string; to: string | null }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextComplaintId: 0,
      maxComplaints: 1000,
      submissionFee: 500,
      authorityContract: null,
      complaints: new Map(),
      complaintsByTitle: new Map(),
      complaintUpdates: new Map(),
      complaintsByComplainant: new Map(),
      complaintsByCategory: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1PQHQKV0RJXZHJ1DG7E4MCRHU6EQ5XACP187S9";
    this.authorities = new Set(["ST1PQHQKV0RJXZHJ1DG7E4MCRHU6EQ5XACP187S9"]);
    this.stxTransfers = [];
  }

  isVerifiedAuthority(principal: string): Result<boolean> {
    return { ok: true, value: this.authorities.has(principal) };
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (contractPrincipal === "SP000000000000000000002Q6VF78") {
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    }
    if (this.state.authorityContract !== null) {
      return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };
    }
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setSubmissionFee(newFee: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };
    this.state.submissionFee = newFee;
    return { ok: true, value: true };
  }

  submitComplaint(
    title: string,
    description: string,
    tags: string[],
    urgency: number,
    evidenceHash: string,
    category: string,
    costEstimate: number
  ): Result<number> {
    if (this.state.nextComplaintId >= this.state.maxComplaints) return { ok: false, value: ERR_MAX_COMPLAINTS_EXCEEDED };
    if (!title || title.length > 100) return { ok: false, value: ERR_INVALID_TITLE };
    if (!description || description.length > 500) return { ok: false, value: ERR_INVALID_DESCRIPTION };
    if (tags.length === 0 || tags.length > 10 || tags.some(t => t.length > 32)) return { ok: false, value: ERR_INVALID_TAGS };
    if (![1, 2, 3].includes(urgency)) return { ok: false, value: ERR_INVALID_URGENCY };
    if (evidenceHash.length !== 64) return { ok: false, value: ERR_INVALID_EVIDENCE_HASH };
    if (!["cyber", "privacy", "evidence", "scam"].includes(category)) return { ok: false, value: ERR_INVALID_CATEGORY };
    if (costEstimate > 1000000) return { ok: false, value: ERR_INVALID_COST_ESTIMATE };
    if (this.state.complaintsByTitle.has(title)) return { ok: false, value: ERR_COMPLAINT_ALREADY_EXISTS };
    if (!this.isVerifiedAuthority(this.caller).value) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };

    this.stxTransfers.push({ amount: this.state.submissionFee, from: this.caller, to: this.state.authorityContract });

    const id = this.state.nextComplaintId;
    const complaint: Complaint = {
      title,
      description,
      tags,
      urgency,
      evidenceHash,
      category,
      costEstimate,
      timestamp: this.blockHeight,
      complainant: this.caller,
      status: "open",
      matchedProvider: null,
      resolutionHash: null,
    };
    this.state.complaints.set(id, complaint);
    this.state.complaintsByTitle.set(title, id);

    if (!this.state.complaintsByComplainant.has(this.caller)) {
      this.state.complaintsByComplainant.set(this.caller, []);
    }
    this.state.complaintsByComplainant.get(this.caller)!.push(id);

    if (!this.state.complaintsByCategory.has(category)) {
      this.state.complaintsByCategory.set(category, []);
    }
    const catList = this.state.complaintsByCategory.get(category)!;
    if (catList.length < 100) {
      catList.push(id);
      this.state.complaintsByCategory.set(category, catList);
    }

    this.state.nextComplaintId++;
    return { ok: true, value: id };
  }

  getComplaint(id: number): Complaint | null {
    return this.state.complaints.get(id) || null;
  }

  updateStatus(id: number, newStatus: string, provider: string | null): Result<boolean | number> {
    const complaint = this.state.complaints.get(id);
    if (!complaint) return { ok: false, value: ERR_COMPLAINT_NOT_FOUND };
    if (!["open", "matched", "resolved", "disputed"].includes(newStatus)) return { ok: false, value: ERR_INVALID_STATUS };
    const isComplainant = complaint.complainant === this.caller;
    const isProvider = provider === this.caller;
    if (!isComplainant && !isProvider) return { ok: false, value: ERR_NOT_AUTHORIZED };

    const updated: Complaint = {
      ...complaint,
      status: newStatus,
      matchedProvider: provider ?? null,
    };
    this.state.complaints.set(id, updated);
    this.state.complaintUpdates.set(id, {
      updateTitle: complaint.title,
      updateDescription: complaint.description,
      updateTags: complaint.tags,
      updateTimestamp: this.blockHeight,
      updater: this.caller,
    });
    return { ok: true, value: true };
  }

  addResolutionHash(id: number, resolutionHash: string): Result<boolean | number> {
    const complaint = this.state.complaints.get(id);
    if (!complaint) return { ok: false, value: ERR_COMPLAINT_NOT_FOUND };
    if (complaint.status !== "resolved") return { ok: false, value: ERR_COMPLAINT_UPDATE_NOT_ALLOWED };
    if (complaint.matchedProvider !== this.caller) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (resolutionHash.length !== 64) return { ok: false, value: ERR_INVALID_EVIDENCE_HASH };

    const updated: Complaint = {
      ...complaint,
      resolutionHash,
    };
    this.state.complaints.set(id, updated);
    return { ok: true, value: true };
  }

  getComplaintCount(): Result<number> {
    return { ok: true, value: this.state.nextComplaintId };
  }

  checkComplaintExistence(complainant: string, id: number): Result<boolean> {
    const ids = this.state.complaintsByComplainant.get(complainant) || [];
    return { ok: true, value: ids.includes(id) };
  }

  getComplaintsByCategory(category: string): number[] {
    return this.state.complaintsByCategory.get(category) || [];
  }
}

describe("ComplaintRegistry", () => {
  let contract: ComplaintRegistryMock;

  beforeEach(() => {
    contract = new ComplaintRegistryMock();
    contract.reset();
  });

  it("submits a complaint successfully", () => {
    contract.setAuthorityContract("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6tAtPDZ5rGd");
    const tags = ["cyber", "breach"];
    const result = contract.submitComplaint(
      "Data Breach Incident",
      "Unauthorized access to user data on Nov 10, 2025.",
      tags,
      3,
      "0000000000000000000000000000000000000000000000000000000000000000",
      "cyber",
      2500
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);

    const complaint = contract.getComplaint(0);
    expect(complaint?.title).toBe("Data Breach Incident");
    expect(complaint?.description).toBe("Unauthorized access to user data on Nov 10, 2025.");
    expect(complaint?.tags).toEqual(tags);
    expect(complaint?.urgency).toBe(3);
    expect(complaint?.category).toBe("cyber");
    expect(complaint?.costEstimate).toBe(2500);
    expect(complaint?.status).toBe("open");
    expect(contract.stxTransfers).toEqual([{ amount: 500, from: "ST1PQHQKV0RJXZHJ1DG7E4MCRHU6EQ5XACP187S9", to: "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6tAtPDZ5rGd" }]);
    expect(contract.getComplaintsByCategory("cyber")).toEqual([0]);
  });

  it("rejects duplicate complaint title", () => {
    contract.setAuthorityContract("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6tAtPDZ5rGd");
    contract.submitComplaint(
      "Test",
      "Desc",
      ["tag"],
      1,
      "0000000000000000000000000000000000000000000000000000000000000000",
      "privacy",
      1000
    );
    const result = contract.submitComplaint(
      "Test",
      "Desc2",
      ["tag2"],
      2,
      "0000000000000000000000000000000000000000000000000000000000000000",
      "scam",
      2000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_COMPLAINT_ALREADY_EXISTS);
  });

  it("rejects non-authorized caller", () => {
    contract.setAuthorityContract("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6tAtPDZ5rGd");
    contract.caller = "ST39FME8GVNM74K6D6MGVF9FVA1NYFPRZ7T5EPR7K";
    contract.authorities = new Set();
    const result = contract.submitComplaint(
      "Unauthorized",
      "Desc",
      ["tag"],
      1,
      "0000000000000000000000000000000000000000000000000000000000000000",
      "evidence",
      1000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects submission without authority contract", () => {
    const result = contract.submitComplaint(
      "NoAuth",
      "Desc",
      ["tag"],
      1,
      "0000000000000000000000000000000000000000000000000000000000000000",
      "cyber",
      1000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_AUTHORITY_NOT_VERIFIED);
  });

  it("rejects invalid title", () => {
    contract.setAuthorityContract("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6tAtPDZ5rGd");
    const result = contract.submitComplaint(
      "",
      "Desc",
      ["tag"],
      1,
      "0000000000000000000000000000000000000000000000000000000000000000",
      "cyber",
      1000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_TITLE);
  });

  it("rejects invalid tags", () => {
    contract.setAuthorityContract("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6tAtPDZ5rGd");
    const result = contract.submitComplaint(
      "Title",
      "Desc",
      [],
      1,
      "0000000000000000000000000000000000000000000000000000000000000000",
      "cyber",
      1000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_TAGS);
  });

  it("rejects invalid urgency", () => {
    contract.setAuthorityContract("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6tAtPDZ5rGd");
    const result = contract.submitComplaint(
      "Title",
      "Desc",
      ["tag"],
      4,
      "0000000000000000000000000000000000000000000000000000000000000000",
      "cyber",
      1000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_URGENCY);
  });

  it("rejects invalid category", () => {
    contract.setAuthorityContract("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6tAtPDZ5rGd");
    const result = contract.submitComplaint(
      "Title",
      "Desc",
      ["tag"],
      1,
      "0000000000000000000000000000000000000000000000000000000000000000",
      "invalid",
      1000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_CATEGORY);
  });

  it("updates status successfully by complainant", () => {
    contract.setAuthorityContract("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6tAtPDZ5rGd");
    contract.submitComplaint(
      "Title",
      "Desc",
      ["tag"],
      1,
      "0000000000000000000000000000000000000000000000000000000000000000",
      "cyber",
      1000
    );
    const result = contract.updateStatus(0, "matched", "ST3F4541SD2TDEVEHRAJZKAWYDQWTG8C3YVKSFG2P");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const complaint = contract.getComplaint(0);
    expect(complaint?.status).toBe("matched");
    expect(complaint?.matchedProvider).toBe("ST3F4541SD2TDEVEHRAJZKAWYDQWTG8C3YVKSFG2P");
    const update = contract.state.complaintUpdates.get(0);
    expect(update?.updater).toBe("ST1PQHQKV0RJXZHJ1DG7E4MCRHU6EQ5XACP187S9");
  });

  it("updates status successfully by provider", () => {
    contract.setAuthorityContract("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6tAtPDZ5rGd");
    contract.submitComplaint(
      "Title",
      "Desc",
      ["tag"],
      1,
      "0000000000000000000000000000000000000000000000000000000000000000",
      "cyber",
      1000
    );
    contract.caller = "ST3F4541SD2TDEVEHRAJZKAWYDQWTG8C3YVKSFG2P";
    const result = contract.updateStatus(0, "resolved", "ST3F4541SD2TDEVEHRAJZKAWYDQWTG8C3YVKSFG2P");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const complaint = contract.getComplaint(0);
    expect(complaint?.status).toBe("resolved");
  });

  it("rejects status update by unauthorized", () => {
    contract.setAuthorityContract("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6tAtPDZ5rGd");
    contract.submitComplaint(
      "Title",
      "Desc",
      ["tag"],
      1,
      "0000000000000000000000000000000000000000000000000000000000000000",
      "cyber",
      1000
    );
    contract.caller = "ST39FME8GVNM74K6D6MGVF9FVA1NYFPRZ7T5EPR7K";
    const result = contract.updateStatus(0, "matched", null);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects invalid status", () => {
    contract.setAuthorityContract("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6tAtPDZ5rGd");
    contract.submitComplaint(
      "Title",
      "Desc",
      ["tag"],
      1,
      "0000000000000000000000000000000000000000000000000000000000000000",
      "cyber",
      1000
    );
    const result = contract.updateStatus(0, "invalid", null);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_STATUS);
  });

  it("adds resolution hash successfully", () => {
    contract.setAuthorityContract("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6tAtPDZ5rGd");
    contract.submitComplaint(
      "Title",
      "Desc",
      ["tag"],
      1,
      "0000000000000000000000000000000000000000000000000000000000000000",
      "cyber",
      1000
    );
    contract.caller = "ST3F4541SD2TDEVEHRAJZKAWYDQWTG8C3YVKSFG2P";
    contract.updateStatus(0, "resolved", "ST3F4541SD2TDEVEHRAJZKAWYDQWTG8C3YVKSFG2P");
    contract.caller = "ST3F4541SD2TDEVEHRAJZKAWYDQWTG8C3YVKSFG2P";
    const result = contract.addResolutionHash(0, "0000000000000000000000000000000000000000000000000000000000000000");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const complaint = contract.getComplaint(0);
    expect(complaint?.resolutionHash).toBe("0000000000000000000000000000000000000000000000000000000000000000");
  });

  it("rejects resolution hash for non-resolved", () => {
    contract.setAuthorityContract("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6tAtPDZ5rGd");
    contract.submitComplaint(
      "Title",
      "Desc",
      ["tag"],
      1,
      "0000000000000000000000000000000000000000000000000000000000000000",
      "cyber",
      1000
    );
    contract.caller = "ST3F4541SD2TDEVEHRAJZKAWYDQWTG8C3YVKSFG2P";
    const result = contract.addResolutionHash(0, "0000000000000000000000000000000000000000000000000000000000000000");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_COMPLAINT_UPDATE_NOT_ALLOWED);
  });

  it("rejects resolution hash by non-provider", () => {
    contract.setAuthorityContract("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6tAtPDZ5rGd");
    contract.submitComplaint(
      "Title",
      "Desc",
      ["tag"],
      1,
      "0000000000000000000000000000000000000000000000000000000000000000",
      "cyber",
      1000
    );
    contract.caller = "ST3F4541SD2TDEVEHRAJZKAWYDQWTG8C3YVKSFG2P";
    contract.updateStatus(0, "resolved", "ST3F4541SD2TDEVEHRAJZKAWYDQWTG8C3YVKSFG2P");
    contract.caller = "ST1PQHQKV0RJXZHJ1DG7E4MCRHU6EQ5XACP187S9";
    const result = contract.addResolutionHash(0, "0000000000000000000000000000000000000000000000000000000000000000");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects invalid resolution hash length", () => {
    contract.setAuthorityContract("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6tAtPDZ5rGd");
    contract.submitComplaint(
      "Title",
      "Desc",
      ["tag"],
      1,
      "0000000000000000000000000000000000000000000000000000000000000000",
      "cyber",
      1000
    );
    contract.caller = "ST3F4541SD2TDEVEHRAJZKAWYDQWTG8C3YVKSFG2P";
    contract.updateStatus(0, "resolved", "ST3F4541SD2TDEVEHRAJZKAWYDQWTG8C3YVKSFG2P");
    contract.caller = "ST3F4541SD2TDEVEHRAJZKAWYDQWTG8C3YVKSFG2P";
    const result = contract.addResolutionHash(0, "short");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_EVIDENCE_HASH);
  });

  it("returns correct complaint count", () => {
    contract.setAuthorityContract("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6tAtPDZ5rGd");
    contract.submitComplaint(
      "Group1",
      "Desc1",
      ["tag1"],
      1,
      "0000000000000000000000000000000000000000000000000000000000000000",
      "cyber",
      1000
    );
    contract.submitComplaint(
      "Group2",
      "Desc2",
      ["tag2"],
      2,
      "0000000000000000000000000000000000000000000000000000000000000000",
      "privacy",
      2000
    );
    const result = contract.getComplaintCount();
    expect(result).toEqual({ ok: true, value: 2 });
  });

  it("checks complaint existence correctly", () => {
    contract.setAuthorityContract("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6tAtPDZ5rGd");
    contract.submitComplaint(
      "Test",
      "Desc",
      ["tag"],
      1,
      "0000000000000000000000000000000000000000000000000000000000000000",
      "cyber",
      1000
    );
    const result = contract.checkComplaintExistence("ST1PQHQKV0RJXZHJ1DG7E4MCRHU6EQ5XACP187S9", 0);
    expect(result).toEqual({ ok: true, value: true });
    const result2 = contract.checkComplaintExistence("ST1PQHQKV0RJXZHJ1DG7E4MCRHU6EQ5XACP187S9", 1);
    expect(result2).toEqual({ ok: true, value: false });
  });

  it("rejects submission with max complaints exceeded", () => {
    contract.setAuthorityContract("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6tAtPDZ5rGd");
    contract.state.maxComplaints = 1;
    contract.submitComplaint(
      "First",
      "Desc",
      ["tag"],
      1,
      "0000000000000000000000000000000000000000000000000000000000000000",
      "cyber",
      1000
    );
    const result = contract.submitComplaint(
      "Second",
      "Desc2",
      ["tag2"],
      1,
      "0000000000000000000000000000000000000000000000000000000000000000",
      "privacy",
      2000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_COMPLAINTS_EXCEEDED);
  });

  it("sets submission fee successfully", () => {
    contract.setAuthorityContract("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6tAtPDZ5rGd");
    const result = contract.setSubmissionFee(1000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.submissionFee).toBe(1000);
    contract.submitComplaint(
      "Test",
      "Desc",
      ["tag"],
      1,
      "0000000000000000000000000000000000000000000000000000000000000000",
      "cyber",
      1000
    );
    expect(contract.stxTransfers).toEqual([{ amount: 1000, from: "ST1PQHQKV0RJXZHJ1DG7E4MCRHU6EQ5XACP187S9", to: "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6tAtPDZ5rGd" }]);
  });

  it("rejects submission fee change without authority", () => {
    const result = contract.setSubmissionFee(1000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_AUTHORITY_NOT_VERIFIED);
  });

  it("sets authority contract successfully", () => {
    const result = contract.setAuthorityContract("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6tAtPDZ5rGd");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.authorityContract).toBe("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6tAtPDZ5rGd");
  });

  it("rejects invalid authority contract", () => {
    const result = contract.setAuthorityContract("SP000000000000000000002Q6VF78");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("handles category list limit", () => {
    contract.setAuthorityContract("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6tAtPDZ5rGd");
    for (let i = 0; i < 100; i++) {
      contract.submitComplaint(`Title${i}`, "Desc", ["tag"], 1, "0000000000000000000000000000000000000000000000000000000000000000", "cyber", 1000);
    }
    const result = contract.submitComplaint("Title101", "Desc", ["tag"], 1, "0000000000000000000000000000000000000000000000000000000000000000", "cyber", 1000);
    expect(result.ok).toBe(true);
    expect(contract.getComplaintsByCategory("cyber").length).toBe(100);
  });
});