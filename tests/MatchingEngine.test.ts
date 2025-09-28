// tests/MatchingEngine.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import { uintCV } from "@stacks/transactions";

const ERR_NO_COMPLAINT = 100;
const ERR_NO_PROVIDERS = 101;
const ERR_INSUFFICIENT_REPUTATION = 110;
const ERR_INVALID_TAG_OVERLAP = 103;
const ERR_INVALID_PROPOSAL_ID = 112;
const ERR_PROPOSAL_EXPIRED = 113;
const ERR_NOT_AUTHORIZED = 106;
const ERR_NO_ACTIVE_PROVIDERS = 122;
const ERR_INVALID_COMPLAINT_STATUS = 108;
const ERR_INVALID_PROVIDER_STATUS = 109;
const ERR_INVALID_MATCH_STATUS = 123;
const ERR_UPDATE_NOT_ALLOWED = 124;
const ERR_INVALID_URGENCY = 107;
const ERR_INVALID_AMOUNT = 114;
const ERR_INVALID_REPUTATION = 102;
const ERR_AUTHORITY_NOT_VERIFIED = 116;

interface Complaint {
  id: number;
  tags: string[];
  urgency: number;
  status: string;
  creator: string;
}

interface Provider {
  id: string;
  skills: string[];
  active: boolean;
}

interface Match {
  complaintId: number;
  providerId: string;
  status: string;
  timestamp: number;
  amount: number;
  urgency: number;
  tagOverlap: number;
  reputationScore: number;
}

interface Proposal {
  complaintId: number;
  providerId: string;
  expiry: number;
  proposedAmount: number;
}

interface MatchUpdate {
  updateStatus: string;
  updateTimestamp: number;
  updater: string;
}

interface Ok<T> {
  ok: true;
  value: T;
}

interface Err {
  ok: false;
  value: number;
}

type Result<T> = Ok<T> | Err;

class MatchingEngineMock {
  state: {
    nextProposalId: number;
    maxProposals: number;
    minReputation: number;
    minTagOverlap: number;
    maxProvidersPerMatch: number;
    proposalExpiry: number;
    authorityContract: string | null;
    matches: Map<number, Match>;
    proposals: Map<number, Proposal>;
    proposalsByComplaint: Map<number, number[]>;
    matchUpdates: Map<number, MatchUpdate>;
  } = {
    nextProposalId: 0,
    maxProposals: 1000,
    minReputation: 70,
    minTagOverlap: 50,
    maxProvidersPerMatch: 10,
    proposalExpiry: 144,
    authorityContract: null,
    matches: new Map(),
    proposals: new Map(),
    proposalsByComplaint: new Map(),
    matchUpdates: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  complaints: Map<number, Complaint> = new Map();
  providers: Map<string, Provider> = new Map();
  reputations: Map<string, number> = new Map();
  escrowDeposits: Array<{ complaintId: number; amount: number; sender: string }> = [];
  statusUpdates: Array<{ complaintId: number; status: string }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextProposalId: 0,
      maxProposals: 1000,
      minReputation: 70,
      minTagOverlap: 50,
      maxProvidersPerMatch: 10,
      proposalExpiry: 144,
      authorityContract: null,
      matches: new Map(),
      proposals: new Map(),
      proposalsByComplaint: new Map(),
      matchUpdates: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.complaints = new Map();
    this.providers = new Map();
    this.reputations = new Map();
    this.escrowDeposits = [];
    this.statusUpdates = [];
  }

  addComplaint(id: number, tags: string[], urgency: number, status: string, creator: string) {
    this.complaints.set(id, { id, tags, urgency, status, creator });
  }

  addProvider(id: string, skills: string[], active: boolean) {
    this.providers.set(id, { id, skills, active });
  }

  setReputation(providerId: string, score: number) {
    this.reputations.set(providerId, score);
  }

  getComplaint(id: number): Complaint | null {
    return this.complaints.get(id) || null;
  }

  getProvider(id: string): Provider | null {
    return this.providers.get(id) || null;
  }

  getScore(providerId: string): number {
    return this.reputations.get(providerId) || 0;
  }

  getActiveProviders(): string[] {
    return Array.from(this.providers.entries())
      .filter(([, p]) => p.active)
      .map(([id]) => id);
  }

  depositEscrow(complaintId: number, amount: number, sender: string): Result<boolean> {
    this.escrowDeposits.push({ complaintId, amount, sender });
    return { ok: true, value: true };
  }

  updateStatus(complaintId: number, status: string): Result<boolean> {
    this.statusUpdates.push({ complaintId, status });
    const complaint = this.complaints.get(complaintId);
    if (complaint) {
      this.complaints.set(complaintId, { ...complaint, status });
    }
    return { ok: true, value: true };
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (this.state.authorityContract !== null) {
      return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };
    }
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setMinReputation(newMin: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };
    if (newMin <= 0) return { ok: false, value: ERR_INVALID_REPUTATION };
    this.state.minReputation = newMin;
    return { ok: true, value: true };
  }

  setMinTagOverlap(newMin: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };
    if (newMin <= 0) return { ok: false, value: ERR_INVALID_TAG_OVERLAP };
    this.state.minTagOverlap = newMin;
    return { ok: true, value: true };
  }

  setMaxProvidersPerMatch(newMax: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };
    if (newMax <= 0) return { ok: false, value: ERR_INVALID_REPUTATION };
    this.state.maxProvidersPerMatch = newMax;
    return { ok: true, value: true };
  }

  setProposalExpiry(newExpiry: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };
    if (newExpiry <= 0) return { ok: false, value: ERR_INVALID_REPUTATION };
    this.state.proposalExpiry = newExpiry;
    return { ok: true, value: true };
  }

  requestMatch(complaintId: number): Result<boolean> {
    const complaint = this.getComplaint(complaintId);
    if (!complaint) return { ok: false, value: ERR_NO_COMPLAINT };
    if (complaint.status !== "open") return { ok: false, value: ERR_INVALID_COMPLAINT_STATUS };
    if (complaint.urgency <= 0 || complaint.urgency > 10) return { ok: false, value: ERR_INVALID_URGENCY };
    const providers = this.getActiveProviders().slice(0, this.state.maxProvidersPerMatch);
    if (providers.length === 0) return { ok: false, value: ERR_NO_PROVIDERS };
    const filtered = providers.filter(p => {
      const provider = this.getProvider(p);
      if (!provider || !provider.active) return false;
      const score = this.getScore(p);
      if (score < this.state.minReputation) return false;
      const overlap = complaint.tags.reduce((sum, tag) => sum + (provider.skills.includes(tag) ? 10 : 0), 0);
      if (overlap < this.state.minTagOverlap) return false;
      return true;
    });
    if (filtered.length === 0) return { ok: false, value: ERR_NO_ACTIVE_PROVIDERS };
    filtered.forEach(providerId => this.proposeMatchForProvider(providerId, complaintId, complaint.urgency));
    return { ok: true, value: true };
  }

  public proposeMatchForProvider(provider: string, complaintId: number, urgency: number): Result<number> {
    const complaint = this.getComplaint(complaintId);
    if (!complaint) return { ok: false, value: ERR_NO_COMPLAINT };
    const prov = this.getProvider(provider);
    if (!prov || !prov.active) return { ok: false, value: ERR_INVALID_PROVIDER_STATUS };
    const score = this.getScore(provider);
    if (score < this.state.minReputation) return { ok: false, value: ERR_INSUFFICIENT_REPUTATION };
    const overlap = complaint.tags.reduce((sum, tag) => sum + (prov.skills.includes(tag) ? 10 : 0), 0);
    if (overlap < this.state.minTagOverlap) return { ok: false, value: ERR_INVALID_TAG_OVERLAP };
    const amount = urgency * 10 + overlap * 5;
    if (amount <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    const id = this.state.nextProposalId;
    this.state.proposals.set(id, {
      complaintId,
      providerId: provider,
      expiry: this.blockHeight + this.state.proposalExpiry,
      proposedAmount: amount,
    });
    const current = this.state.proposalsByComplaint.get(complaintId) || [];
    this.state.proposalsByComplaint.set(complaintId, [...current, id].slice(-10));
    this.state.nextProposalId++;
    return { ok: true, value: id };
  }

  acceptMatch(proposalId: number): Result<boolean> {
    const proposal = this.state.proposals.get(proposalId);
    if (!proposal) return { ok: false, value: ERR_INVALID_PROPOSAL_ID };
    const complaint = this.getComplaint(proposal.complaintId);
    if (!complaint) return { ok: false, value: ERR_NO_COMPLAINT };
    if (this.caller !== complaint.creator) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (this.blockHeight >= proposal.expiry) return { ok: false, value: ERR_PROPOSAL_EXPIRED };
    this.depositEscrow(proposal.complaintId, proposal.proposedAmount, this.caller);
    this.updateStatus(proposal.complaintId, "matched");
    const overlap = complaint.tags.reduce((sum, tag) => {
      const prov = this.getProvider(proposal.providerId);
      return sum + (prov && prov.skills.includes(tag) ? 10 : 0);
    }, 0);
    this.state.matches.set(proposal.complaintId, {
      complaintId: proposal.complaintId,
      providerId: proposal.providerId,
      status: "accepted",
      timestamp: this.blockHeight,
      amount: proposal.proposedAmount,
      urgency: complaint.urgency,
      tagOverlap: overlap,
      reputationScore: this.getScore(proposal.providerId),
    });
    return { ok: true, value: true };
  }

  rejectMatch(proposalId: number): Result<boolean> {
    const proposal = this.state.proposals.get(proposalId);
    if (!proposal) return { ok: false, value: ERR_INVALID_PROPOSAL_ID };
    const complaint = this.getComplaint(proposal.complaintId);
    if (!complaint || this.caller !== complaint.creator) return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.proposals.delete(proposalId);
    return { ok: true, value: true };
  }

  updateMatchStatus(matchId: number, newStatus: string): Result<boolean> {
    const match = this.state.matches.get(matchId);
    if (!match) return { ok: false, value: ERR_NO_COMPLAINT };
    if (this.caller !== match.providerId) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (!["pending", "accepted", "rejected"].includes(newStatus)) return { ok: false, value: ERR_INVALID_MATCH_STATUS };
    if (match.status === "completed") return { ok: false, value: ERR_UPDATE_NOT_ALLOWED };
    this.state.matches.set(matchId, { ...match, status: newStatus, timestamp: this.blockHeight });
    this.state.matchUpdates.set(matchId, {
      updateStatus: newStatus,
      updateTimestamp: this.blockHeight,
      updater: this.caller,
    });
    return { ok: true, value: true };
  }
}

describe("MatchingEngine", () => {
  let contract: MatchingEngineMock;

  beforeEach(() => {
    contract = new MatchingEngineMock();
    contract.reset();
  });

  it("sets authority contract successfully", () => {
    const result = contract.setAuthorityContract("ST2TEST");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.authorityContract).toBe("ST2TEST");
  });

  it("sets min reputation successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setMinReputation(80);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.minReputation).toBe(80);
  });

  it("sets min tag overlap successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setMinTagOverlap(60);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.minTagOverlap).toBe(60);
  });

  it("sets max providers per match successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setMaxProvidersPerMatch(5);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.maxProvidersPerMatch).toBe(5);
  });

  it("sets proposal expiry successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setProposalExpiry(288);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.proposalExpiry).toBe(288);
  });

  it("requests match successfully", () => {
    const tags = ["tag1", "tag2", "tag3", "tag4", "tag5"];
    const skills = ["tag1", "tag2", "tag3", "tag4", "tag5"];
    contract.addComplaint(1, tags, 5, "open", "ST1TEST");
    contract.addProvider("STPROV1", skills, true);
    contract.addProvider("STPROV2", skills, true);
    contract.setReputation("STPROV1", 80);
    contract.setReputation("STPROV2", 75);
    const result = contract.requestMatch(1);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.proposals.size).toBe(2);
  });

  it("rejects request match with no complaint", () => {
    const result = contract.requestMatch(99);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NO_COMPLAINT);
  });

  it("rejects request match with invalid status", () => {
    contract.addComplaint(1, ["cyber"], 5, "closed", "ST1TEST");
    const result = contract.requestMatch(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_COMPLAINT_STATUS);
  });

  it("rejects request match with no active providers", () => {
    const tags = ["tag1", "tag2", "tag3", "tag4", "tag5"];
    contract.addComplaint(1, tags, 5, "open", "ST1TEST");
    contract.addProvider("STPROV1", ["other"], true);
    contract.setReputation("STPROV1", 80);
    const result = contract.requestMatch(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NO_ACTIVE_PROVIDERS);
  });

  it("accepts match successfully", () => {
    const tags = ["tag1", "tag2", "tag3", "tag4", "tag5"];
    const skills = ["tag1", "tag2", "tag3", "tag4", "tag5"];
    contract.addComplaint(1, tags, 5, "open", "ST1TEST");
    contract.addProvider("STPROV1", skills, true);
    contract.setReputation("STPROV1", 80);
    contract.proposeMatchForProvider("STPROV1", 1, 5);
    const result = contract.acceptMatch(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.matches.size).toBe(1);
    expect(contract.escrowDeposits.length).toBe(1);
    expect(contract.statusUpdates.length).toBe(1);
  });

  it("rejects accept match with invalid proposal", () => {
    const result = contract.acceptMatch(99);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_PROPOSAL_ID);
  });

  it("rejects accept match if not authorized", () => {
    const tags = ["tag1", "tag2", "tag3", "tag4", "tag5"];
    const skills = ["tag1", "tag2", "tag3", "tag4", "tag5"];
    contract.addComplaint(1, tags, 5, "open", "STOTHER");
    contract.addProvider("STPROV1", skills, true);
    contract.setReputation("STPROV1", 80);
    contract.proposeMatchForProvider("STPROV1", 1, 5);
    const result = contract.acceptMatch(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects accept match if expired", () => {
    const tags = ["tag1", "tag2", "tag3", "tag4", "tag5"];
    const skills = ["tag1", "tag2", "tag3", "tag4", "tag5"];
    contract.addComplaint(1, tags, 5, "open", "ST1TEST");
    contract.addProvider("STPROV1", skills, true);
    contract.setReputation("STPROV1", 80);
    contract.proposeMatchForProvider("STPROV1", 1, 5);
    contract.blockHeight += 145;
    const result = contract.acceptMatch(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_PROPOSAL_EXPIRED);
  });

  it("rejects match successfully", () => {
    const tags = ["tag1", "tag2", "tag3", "tag4", "tag5"];
    const skills = ["tag1", "tag2", "tag3", "tag4", "tag5"];
    contract.addComplaint(1, tags, 5, "open", "ST1TEST");
    contract.addProvider("STPROV1", skills, true);
    contract.setReputation("STPROV1", 80);
    contract.proposeMatchForProvider("STPROV1", 1, 5);
    const result = contract.rejectMatch(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.proposals.size).toBe(0);
  });

  it("rejects reject match if not authorized", () => {
    const tags = ["tag1", "tag2", "tag3", "tag4", "tag5"];
    const skills = ["tag1", "tag2", "tag3", "tag4", "tag5"];
    contract.addComplaint(1, tags, 5, "open", "STOTHER");
    contract.addProvider("STPROV1", skills, true);
    contract.setReputation("STPROV1", 80);
    contract.proposeMatchForProvider("STPROV1", 1, 5);
    const result = contract.rejectMatch(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("updates match status successfully", () => {
    const tags = ["tag1", "tag2", "tag3", "tag4", "tag5"];
    const skills = ["tag1", "tag2", "tag3", "tag4", "tag5"];
    contract.addComplaint(1, tags, 5, "open", "ST1TEST");
    contract.addProvider("STPROV1", skills, true);
    contract.setReputation("STPROV1", 80);
    contract.proposeMatchForProvider("STPROV1", 1, 5);
    contract.acceptMatch(0);
    contract.caller = "STPROV1";
    const result = contract.updateMatchStatus(1, "pending");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const match = contract.state.matches.get(1);
    expect(match?.status).toBe("pending");
  });

  it("rejects update match status if not authorized", () => {
    const tags = ["tag1", "tag2", "tag3", "tag4", "tag5"];
    const skills = ["tag1", "tag2", "tag3", "tag4", "tag5"];
    contract.addComplaint(1, tags, 5, "open", "ST1TEST");
    contract.addProvider("STPROV1", skills, true);
    contract.setReputation("STPROV1", 80);
    contract.proposeMatchForProvider("STPROV1", 1, 5);
    contract.acceptMatch(0);
    const result = contract.updateMatchStatus(1, "pending");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects update match status if completed", () => {
    const tags = ["tag1", "tag2", "tag3", "tag4", "tag5"];
    const skills = ["tag1", "tag2", "tag3", "tag4", "tag5"];
    contract.addComplaint(1, tags, 5, "open", "ST1TEST");
    contract.addProvider("STPROV1", skills, true);
    contract.setReputation("STPROV1", 80);
    contract.proposeMatchForProvider("STPROV1", 1, 5);
    contract.acceptMatch(0);
    contract.caller = "STPROV1";
    let match = contract.state.matches.get(1);
    if (match) {
      contract.state.matches.set(1, { ...match, status: "completed" });
    }
    const result = contract.updateMatchStatus(1, "pending");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_UPDATE_NOT_ALLOWED);
  });

  it("rejects update with invalid status", () => {
    const tags = ["tag1", "tag2", "tag3", "tag4", "tag5"];
    const skills = ["tag1", "tag2", "tag3", "tag4", "tag5"];
    contract.addComplaint(1, tags, 5, "open", "ST1TEST");
    contract.addProvider("STPROV1", skills, true);
    contract.setReputation("STPROV1", 80);
    contract.proposeMatchForProvider("STPROV1", 1, 5);
    contract.acceptMatch(0);
    contract.caller = "STPROV1";
    const result = contract.updateMatchStatus(1, "invalid");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_MATCH_STATUS);
  });

  it("parses parameters with Clarity types", () => {
    const id = uintCV(1);
    expect(id.value).toEqual(BigInt(1));
  });
});