/**
 * UBI Corporate Accounts Service
 *
 * Manages B2B organizations, members, cost centers, approval policies,
 * and corporate trip bookings.
 */

import { EventEmitter } from "node:events";
import { nanoid } from "nanoid";
import type {
  ApprovalCondition,
  ApprovalPolicy,
  ApprovalRequest,
  ApprovalStatus,
  BookForEmployeeRequest,
  CorporateTrip,
  CostCenter,
  CreateCorporateTripRequest,
  CreateCostCenterRequest,
  CreateOrganizationRequest,
  Department,
  InviteMemberRequest,
  MemberPermission,
  MemberRole,
  MemberStatus,
  Organization,
  OrganizationMember,
  OrganizationSettings,
  OrganizationSize,
  OrganizationStatus,
  OrganizationType,
  PaginatedResponse,
  PaginationParams,
  PolicyCheckResult,
  UpdateMemberRequest,
  UpdateOrganizationRequest,
} from "../types/b2b.types";

// =============================================================================
// ROLE PERMISSIONS MAPPING
// =============================================================================

const ROLE_PERMISSIONS: Record<MemberRole, MemberPermission[]> = {
  OWNER: [
    "trips:create",
    "trips:view",
    "trips:view_all",
    "trips:approve",
    "trips:cancel",
    "deliveries:create",
    "deliveries:view",
    "deliveries:view_all",
    "deliveries:cancel",
    "members:invite",
    "members:manage",
    "members:remove",
    "reports:view",
    "reports:export",
    "billing:view",
    "billing:manage",
    "settings:view",
    "settings:manage",
    "api:manage",
    "integrations:manage",
  ],
  ADMIN: [
    "trips:create",
    "trips:view",
    "trips:view_all",
    "trips:approve",
    "trips:cancel",
    "deliveries:create",
    "deliveries:view",
    "deliveries:view_all",
    "deliveries:cancel",
    "members:invite",
    "members:manage",
    "reports:view",
    "reports:export",
    "billing:view",
    "settings:view",
    "settings:manage",
    "api:manage",
    "integrations:manage",
  ],
  FINANCE_ADMIN: [
    "trips:view",
    "trips:view_all",
    "deliveries:view",
    "deliveries:view_all",
    "reports:view",
    "reports:export",
    "billing:view",
    "billing:manage",
    "settings:view",
  ],
  MANAGER: [
    "trips:create",
    "trips:view",
    "trips:view_all",
    "trips:approve",
    "trips:cancel",
    "deliveries:create",
    "deliveries:view",
    "deliveries:view_all",
    "deliveries:cancel",
    "members:invite",
    "reports:view",
    "settings:view",
  ],
  DISPATCHER: [
    "trips:create",
    "trips:view",
    "trips:view_all",
    "trips:cancel",
    "deliveries:create",
    "deliveries:view",
    "deliveries:view_all",
    "deliveries:cancel",
    "reports:view",
  ],
  MEMBER: [
    "trips:create",
    "trips:view",
    "deliveries:create",
    "deliveries:view",
  ],
  VIEWER: ["trips:view", "deliveries:view", "reports:view"],
};

// =============================================================================
// SERVICE INTERFACES
// =============================================================================

interface OrganizationFilters {
  type?: OrganizationType;
  status?: OrganizationStatus;
  size?: OrganizationSize;
  country?: string;
  search?: string;
}

interface MemberFilters {
  role?: MemberRole;
  status?: MemberStatus;
  departmentId?: string;
  search?: string;
}

interface TripFilters {
  memberId?: string;
  costCenterId?: string;
  status?: string;
  approvalStatus?: ApprovalStatus;
  dateFrom?: Date;
  dateTo?: Date;
}

// =============================================================================
// CORPORATE ACCOUNTS SERVICE
// =============================================================================

export class CorporateAccountsService extends EventEmitter {
  private organizations: Map<string, Organization> = new Map();
  private members: Map<string, OrganizationMember> = new Map();
  private costCenters: Map<string, CostCenter> = new Map();
  private departments: Map<string, Department> = new Map();
  private approvalPolicies: Map<string, ApprovalPolicy> = new Map();
  private approvalRequests: Map<string, ApprovalRequest> = new Map();
  private corporateTrips: Map<string, CorporateTrip> = new Map();

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  // ===========================================================================
  // ORGANIZATION MANAGEMENT
  // ===========================================================================

  /**
   * Create a new B2B organization
   */
  async createOrganization(
    request: CreateOrganizationRequest,
    creatorUserId: string
  ): Promise<Organization> {
    const slug = this.generateSlug(request.name);

    // Check for duplicate slug
    const existingSlug = Array.from(this.organizations.values()).find(
      (org) => org.slug === slug
    );
    if (existingSlug) {
      throw new Error("Organization name already exists");
    }

    const organization: Organization = {
      id: nanoid(),
      name: request.name,
      slug,
      legalName: request.legalName,
      type: request.type,
      industry: request.industry,
      size: request.size || "SMALL",
      registrationNumber: request.registrationNumber,
      taxId: request.taxId,
      email: request.email,
      billingEmail: request.billingEmail || request.email,
      phone: request.phone,
      website: request.website,
      country: request.country,
      address: request.address,
      settings: this.getDefaultSettings(request.country),
      status: "PENDING_VERIFICATION",
      billingCycle: "MONTHLY",
      creditLimit: this.calculateInitialCreditLimit(request.size),
      currentBalance: 0,
      paymentTermDays: 30,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.organizations.set(organization.id, organization);

    // Create owner member
    await this.createOwnerMember(organization.id, creatorUserId, request.email);

    // Create default cost center
    await this.createCostCenter(organization.id, {
      name: "General",
      code: "GEN",
      description: "Default cost center",
    });

    this.emit("organization:created", organization);

    return organization;
  }

  /**
   * Get organization by ID
   */
  async getOrganization(organizationId: string): Promise<Organization | null> {
    return this.organizations.get(organizationId) || null;
  }

  /**
   * Get organization by slug
   */
  async getOrganizationBySlug(slug: string): Promise<Organization | null> {
    return (
      Array.from(this.organizations.values()).find(
        (org) => org.slug === slug
      ) || null
    );
  }

  /**
   * Update organization
   */
  async updateOrganization(
    organizationId: string,
    updates: UpdateOrganizationRequest
  ): Promise<Organization> {
    const organization = this.organizations.get(organizationId);
    if (!organization) {
      throw new Error("Organization not found");
    }

    const updated: Organization = {
      ...organization,
      ...updates,
      settings: updates.settings
        ? { ...organization.settings, ...updates.settings }
        : organization.settings,
      updatedAt: new Date(),
    };

    this.organizations.set(organizationId, updated);
    this.emit("organization:updated", updated);

    return updated;
  }

  /**
   * Verify organization (admin action)
   */
  async verifyOrganization(
    organizationId: string,
    verifiedBy: string
  ): Promise<Organization> {
    const organization = this.organizations.get(organizationId);
    if (!organization) {
      throw new Error("Organization not found");
    }

    organization.status = "ACTIVE";
    organization.verifiedAt = new Date();
    organization.updatedAt = new Date();

    this.organizations.set(organizationId, organization);
    this.emit("organization:verified", { organization, verifiedBy });

    return organization;
  }

  /**
   * Suspend organization
   */
  async suspendOrganization(
    organizationId: string,
    reason: string
  ): Promise<Organization> {
    const organization = this.organizations.get(organizationId);
    if (!organization) {
      throw new Error("Organization not found");
    }

    organization.status = "SUSPENDED";
    organization.updatedAt = new Date();

    this.organizations.set(organizationId, organization);
    this.emit("organization:suspended", { organization, reason });

    return organization;
  }

  /**
   * List organizations with filters
   */
  async listOrganizations(
    filters: OrganizationFilters,
    pagination: PaginationParams
  ): Promise<PaginatedResponse<Organization>> {
    let orgs = Array.from(this.organizations.values());

    // Apply filters
    if (filters.type) {
      orgs = orgs.filter((o) => o.type === filters.type);
    }
    if (filters.status) {
      orgs = orgs.filter((o) => o.status === filters.status);
    }
    if (filters.size) {
      orgs = orgs.filter((o) => o.size === filters.size);
    }
    if (filters.country) {
      orgs = orgs.filter((o) => o.country === filters.country);
    }
    if (filters.search) {
      const search = filters.search.toLowerCase();
      orgs = orgs.filter(
        (o) =>
          o.name.toLowerCase().includes(search) ||
          o.email.toLowerCase().includes(search)
      );
    }

    // Sort by creation date descending
    orgs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return this.paginate(orgs, pagination);
  }

  // ===========================================================================
  // MEMBER MANAGEMENT
  // ===========================================================================

  /**
   * Invite a member to an organization
   */
  async inviteMember(
    organizationId: string,
    request: InviteMemberRequest,
    invitedBy: string
  ): Promise<OrganizationMember> {
    const organization = this.organizations.get(organizationId);
    if (!organization) {
      throw new Error("Organization not found");
    }

    // Check if member already exists
    const existing = Array.from(this.members.values()).find(
      (m) => m.organizationId === organizationId && m.email === request.email
    );
    if (existing) {
      throw new Error("Member already exists in this organization");
    }

    const member: OrganizationMember = {
      id: nanoid(),
      organizationId,
      email: request.email,
      firstName: request.firstName,
      lastName: request.lastName,
      role: request.role,
      permissions: ROLE_PERMISSIONS[request.role],
      departmentId: request.departmentId,
      employeeId: request.employeeId,
      title: request.title,
      managerId: request.managerId,
      spendingLimitPerTrip: request.spendingLimitPerTrip,
      monthlyLimit: request.monthlyLimit,
      requiresApproval: request.requiresApproval ?? request.role === "MEMBER",
      status: "INVITED",
      invitedBy,
      invitedAt: new Date(),
    };

    this.members.set(member.id, member);
    this.emit("member:invited", member);

    return member;
  }

  /**
   * Accept member invitation
   */
  async acceptInvitation(
    memberId: string,
    userId: string
  ): Promise<OrganizationMember> {
    const member = this.members.get(memberId);
    if (!member) {
      throw new Error("Member not found");
    }

    if (member.status !== "INVITED") {
      throw new Error("Invitation already processed");
    }

    member.userId = userId;
    member.status = "ACTIVE";
    member.joinedAt = new Date();
    member.lastActiveAt = new Date();

    this.members.set(memberId, member);
    this.emit("member:joined", member);

    return member;
  }

  /**
   * Update member details
   */
  async updateMember(
    memberId: string,
    updates: UpdateMemberRequest
  ): Promise<OrganizationMember> {
    const member = this.members.get(memberId);
    if (!member) {
      throw new Error("Member not found");
    }

    const updated: OrganizationMember = {
      ...member,
      ...updates,
      permissions: updates.role
        ? ROLE_PERMISSIONS[updates.role]
        : updates.permissions || member.permissions,
    };

    this.members.set(memberId, updated);
    this.emit("member:updated", updated);

    return updated;
  }

  /**
   * Suspend a member
   */
  async suspendMember(
    memberId: string,
    reason: string
  ): Promise<OrganizationMember> {
    const member = this.members.get(memberId);
    if (!member) {
      throw new Error("Member not found");
    }

    if (member.role === "OWNER") {
      throw new Error("Cannot suspend organization owner");
    }

    member.status = "SUSPENDED";
    this.members.set(memberId, member);
    this.emit("member:suspended", { member, reason });

    return member;
  }

  /**
   * Remove a member from organization
   */
  async removeMember(memberId: string): Promise<void> {
    const member = this.members.get(memberId);
    if (!member) {
      throw new Error("Member not found");
    }

    if (member.role === "OWNER") {
      throw new Error("Cannot remove organization owner");
    }

    member.status = "REMOVED";
    this.members.set(memberId, member);
    this.emit("member:removed", member);
  }

  /**
   * Get member by ID
   */
  async getMember(memberId: string): Promise<OrganizationMember | null> {
    return this.members.get(memberId) || null;
  }

  /**
   * Get member by user ID and organization
   */
  async getMemberByUserId(
    userId: string,
    organizationId: string
  ): Promise<OrganizationMember | null> {
    return (
      Array.from(this.members.values()).find(
        (m) => m.userId === userId && m.organizationId === organizationId
      ) || null
    );
  }

  /**
   * List members in an organization
   */
  async listMembers(
    organizationId: string,
    filters: MemberFilters,
    pagination: PaginationParams
  ): Promise<PaginatedResponse<OrganizationMember>> {
    let members = Array.from(this.members.values()).filter(
      (m) => m.organizationId === organizationId
    );

    if (filters.role) {
      members = members.filter((m) => m.role === filters.role);
    }
    if (filters.status) {
      members = members.filter((m) => m.status === filters.status);
    }
    if (filters.departmentId) {
      members = members.filter((m) => m.departmentId === filters.departmentId);
    }
    if (filters.search) {
      const search = filters.search.toLowerCase();
      members = members.filter(
        (m) =>
          m.firstName.toLowerCase().includes(search) ||
          m.lastName.toLowerCase().includes(search) ||
          m.email.toLowerCase().includes(search)
      );
    }

    return this.paginate(members, pagination);
  }

  /**
   * Check if member has permission
   */
  hasPermission(
    member: OrganizationMember,
    permission: MemberPermission
  ): boolean {
    return member.permissions.includes(permission);
  }

  /**
   * Get all organizations a user belongs to
   */
  async getUserOrganizations(userId: string): Promise<Organization[]> {
    const memberships = Array.from(this.members.values()).filter(
      (m) => m.userId === userId && m.status === "ACTIVE"
    );

    return memberships
      .map((m) => this.organizations.get(m.organizationId)!)
      .filter(Boolean);
  }

  // ===========================================================================
  // COST CENTER MANAGEMENT
  // ===========================================================================

  /**
   * Create a cost center
   */
  async createCostCenter(
    organizationId: string,
    request: CreateCostCenterRequest
  ): Promise<CostCenter> {
    // Check for duplicate code
    const existing = Array.from(this.costCenters.values()).find(
      (c) => c.organizationId === organizationId && c.code === request.code
    );
    if (existing) {
      throw new Error("Cost center code already exists");
    }

    const costCenter: CostCenter = {
      id: nanoid(),
      organizationId,
      name: request.name,
      code: request.code,
      description: request.description,
      parentId: request.parentId,
      budget: request.budget,
      budgetPeriod: request.budgetPeriod,
      budgetUsed: 0,
      budgetAlertThreshold: request.budgetAlertThreshold,
      isActive: true,
    };

    this.costCenters.set(costCenter.id, costCenter);
    this.emit("costCenter:created", costCenter);

    return costCenter;
  }

  /**
   * Update a cost center
   */
  async updateCostCenter(
    costCenterId: string,
    updates: Partial<CreateCostCenterRequest>
  ): Promise<CostCenter> {
    const costCenter = this.costCenters.get(costCenterId);
    if (!costCenter) {
      throw new Error("Cost center not found");
    }

    Object.assign(costCenter, updates);
    this.costCenters.set(costCenterId, costCenter);
    this.emit("costCenter:updated", costCenter);

    return costCenter;
  }

  /**
   * Get cost center by ID
   */
  async getCostCenter(costCenterId: string): Promise<CostCenter | null> {
    return this.costCenters.get(costCenterId) || null;
  }

  /**
   * List cost centers for an organization
   */
  async listCostCenters(organizationId: string): Promise<CostCenter[]> {
    const costCenters = Array.from(this.costCenters.values()).filter(
      (c) => c.organizationId === organizationId && c.isActive
    );

    return this.buildCostCenterHierarchy(costCenters);
  }

  /**
   * Record spending against a cost center
   */
  async recordSpending(
    costCenterId: string,
    amount: number
  ): Promise<{ withinBudget: boolean; remainingBudget?: number }> {
    const costCenter = this.costCenters.get(costCenterId);
    if (!costCenter) {
      throw new Error("Cost center not found");
    }

    costCenter.budgetUsed += amount;
    this.costCenters.set(costCenterId, costCenter);

    const withinBudget =
      !costCenter.budget || costCenter.budgetUsed <= costCenter.budget;
    const remainingBudget = costCenter.budget
      ? Math.max(0, costCenter.budget - costCenter.budgetUsed)
      : undefined;

    // Check budget alerts
    if (costCenter.budget && costCenter.budgetAlertThreshold) {
      const usagePercent = (costCenter.budgetUsed / costCenter.budget) * 100;
      if (usagePercent >= costCenter.budgetAlertThreshold) {
        this.emit("costCenter:budgetAlert", {
          costCenter,
          usagePercent,
          remainingBudget,
        });
      }
    }

    return { withinBudget, remainingBudget };
  }

  // ===========================================================================
  // DEPARTMENT MANAGEMENT
  // ===========================================================================

  /**
   * Create a department
   */
  async createDepartment(
    organizationId: string,
    name: string,
    code?: string,
    headId?: string,
    parentId?: string
  ): Promise<Department> {
    const department: Department = {
      id: nanoid(),
      organizationId,
      name,
      code,
      headId,
      parentId,
      isActive: true,
    };

    this.departments.set(department.id, department);
    this.emit("department:created", department);

    return department;
  }

  /**
   * List departments for an organization
   */
  async listDepartments(organizationId: string): Promise<Department[]> {
    const departments = Array.from(this.departments.values()).filter(
      (d) => d.organizationId === organizationId && d.isActive
    );

    // Count members per department
    for (const dept of departments) {
      dept.memberCount = Array.from(this.members.values()).filter(
        (m) => m.departmentId === dept.id && m.status === "ACTIVE"
      ).length;
    }

    return this.buildDepartmentHierarchy(departments);
  }

  // ===========================================================================
  // APPROVAL POLICY MANAGEMENT
  // ===========================================================================

  /**
   * Create an approval policy
   */
  async createApprovalPolicy(
    organizationId: string,
    policy: Omit<ApprovalPolicy, "id" | "organizationId">
  ): Promise<ApprovalPolicy> {
    const approvalPolicy: ApprovalPolicy = {
      id: nanoid(),
      organizationId,
      ...policy,
    };

    this.approvalPolicies.set(approvalPolicy.id, approvalPolicy);
    this.emit("approvalPolicy:created", approvalPolicy);

    return approvalPolicy;
  }

  /**
   * Update an approval policy
   */
  async updateApprovalPolicy(
    policyId: string,
    updates: Partial<ApprovalPolicy>
  ): Promise<ApprovalPolicy> {
    const policy = this.approvalPolicies.get(policyId);
    if (!policy) {
      throw new Error("Approval policy not found");
    }

    Object.assign(policy, updates);
    this.approvalPolicies.set(policyId, policy);
    this.emit("approvalPolicy:updated", policy);

    return policy;
  }

  /**
   * List approval policies for an organization
   */
  async listApprovalPolicies(
    organizationId: string
  ): Promise<ApprovalPolicy[]> {
    return Array.from(this.approvalPolicies.values())
      .filter((p) => p.organizationId === organizationId && p.isActive)
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Check if a trip/expense requires approval based on policies
   */
  async checkApprovalRequired(
    organizationId: string,
    memberId: string,
    tripDetails: {
      amount: number;
      vehicleType: string;
      isScheduled: boolean;
      purpose?: string;
    }
  ): Promise<PolicyCheckResult> {
    const member = this.members.get(memberId);
    if (!member) {
      throw new Error("Member not found");
    }

    const organization = this.organizations.get(organizationId);
    if (!organization) {
      throw new Error("Organization not found");
    }

    // Check member-level approval requirement
    if (member.requiresApproval) {
      const policies = await this.listApprovalPolicies(organizationId);

      for (const policy of policies) {
        if (this.evaluateConditions(policy.conditions, tripDetails, member)) {
          return {
            requiresApproval: policy.requiresApproval,
            matchedPolicy: policy,
            actions: policy.actions,
          };
        }
      }
    }

    // Check spending limits
    if (
      member.spendingLimitPerTrip &&
      tripDetails.amount > member.spendingLimitPerTrip
    ) {
      return {
        requiresApproval: true,
        actions: [
          {
            type: "require_note",
            message: "Amount exceeds your per-trip limit",
          },
        ],
      };
    }

    // Check organization auto-approve settings
    if (organization.settings.autoApprove && !member.requiresApproval) {
      return {
        requiresApproval: false,
        actions: [],
      };
    }

    return {
      requiresApproval: member.requiresApproval,
      actions: [],
    };
  }

  /**
   * Create an approval request
   */
  async createApprovalRequest(
    organizationId: string,
    memberId: string,
    entityType: "trip" | "delivery" | "expense",
    entityId: string,
    amount: number,
    reason?: string,
    metadata?: Record<string, any>
  ): Promise<ApprovalRequest> {
    const member = this.members.get(memberId);
    if (!member) {
      throw new Error("Member not found");
    }

    const request: ApprovalRequest = {
      id: nanoid(),
      organizationId,
      entityType,
      entityId,
      requesterId: memberId,
      requesterName: `${member.firstName} ${member.lastName}`,
      amount,
      reason,
      metadata: metadata || {},
      status: "PENDING",
      requestedAt: new Date(),
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours
    };

    this.approvalRequests.set(request.id, request);
    this.emit("approval:requested", request);

    return request;
  }

  /**
   * Approve or reject a request
   */
  async processApprovalRequest(
    requestId: string,
    approverId: string,
    approved: boolean,
    notes?: string
  ): Promise<ApprovalRequest> {
    const request = this.approvalRequests.get(requestId);
    if (!request) {
      throw new Error("Approval request not found");
    }

    if (request.status !== "PENDING") {
      throw new Error("Request already processed");
    }

    const approver = this.members.get(approverId);
    if (!approver) {
      throw new Error("Approver not found");
    }

    // Verify approver has permission
    if (!this.hasPermission(approver, "trips:approve")) {
      throw new Error("Insufficient permissions to approve");
    }

    request.status = approved ? "APPROVED" : "REJECTED";
    request.approverId = approverId;
    request.approverName = `${approver.firstName} ${approver.lastName}`;
    request.approverNotes = notes;
    request.respondedAt = new Date();

    this.approvalRequests.set(requestId, request);
    this.emit(`approval:${approved ? "approved" : "rejected"}`, request);

    return request;
  }

  /**
   * Get pending approvals for a member
   */
  async getPendingApprovals(
    organizationId: string,
    approverId: string
  ): Promise<ApprovalRequest[]> {
    const approver = this.members.get(approverId);
    if (!approver) {
      throw new Error("Approver not found");
    }

    // Check if approver has approval permission
    if (!this.hasPermission(approver, "trips:approve")) {
      return [];
    }

    return Array.from(this.approvalRequests.values())
      .filter(
        (r) =>
          r.organizationId === organizationId &&
          r.status === "PENDING" &&
          r.expiresAt &&
          r.expiresAt > new Date()
      )
      .sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());
  }

  // ===========================================================================
  // CORPORATE TRIP MANAGEMENT
  // ===========================================================================

  /**
   * Book a corporate trip
   */
  async bookCorporateTrip(
    organizationId: string,
    memberId: string,
    request: CreateCorporateTripRequest
  ): Promise<CorporateTrip> {
    const organization = this.organizations.get(organizationId);
    if (!organization) {
      throw new Error("Organization not found");
    }

    if (organization.status !== "ACTIVE") {
      throw new Error("Organization is not active");
    }

    const member = this.members.get(memberId);
    if (!member) {
      throw new Error("Member not found");
    }

    if (member.status !== "ACTIVE") {
      throw new Error("Member is not active");
    }

    // Verify required project code if organization requires it
    if (organization.settings.requireProjectCode && !request.projectCode) {
      throw new Error("Project code is required");
    }

    // Estimate trip cost (simplified)
    const estimatedCost = await this.estimateTripCost(
      request.pickupCoordinates,
      request.dropoffCoordinates,
      request.vehicleType || "standard"
    );

    // Check approval requirements
    const approvalCheck = await this.checkApprovalRequired(
      organizationId,
      memberId,
      {
        amount: estimatedCost,
        vehicleType: request.vehicleType || "standard",
        isScheduled: !!request.scheduledAt,
        purpose: request.purpose,
      }
    );

    const trip: CorporateTrip = {
      id: nanoid(),
      organizationId,
      memberId,
      memberName: `${member.firstName} ${member.lastName}`,
      pickupAddress: request.pickupAddress,
      pickupCoordinates: request.pickupCoordinates,
      dropoffAddress: request.dropoffAddress,
      dropoffCoordinates: request.dropoffCoordinates,
      scheduledAt: request.scheduledAt,
      vehicleType: request.vehicleType || "standard",
      purpose: request.purpose,
      projectCode: request.projectCode,
      notes: request.notes,
      costCenterId: request.costCenterId || member.defaultCostCenterId,
      estimatedCost,
      currency: organization.settings.currency,
      requiresApproval: approvalCheck.requiresApproval,
      approvalStatus: approvalCheck.requiresApproval ? "PENDING" : "APPROVED",
      status: approvalCheck.requiresApproval ? "pending_approval" : "pending",
      createdAt: new Date(),
    };

    // Get cost center name if available
    if (trip.costCenterId) {
      const costCenter = this.costCenters.get(trip.costCenterId);
      if (costCenter) {
        trip.costCenterName = costCenter.name;
      }
    }

    this.corporateTrips.set(trip.id, trip);

    // Create approval request if needed
    if (approvalCheck.requiresApproval) {
      const approvalRequest = await this.createApprovalRequest(
        organizationId,
        memberId,
        "trip",
        trip.id,
        estimatedCost,
        request.purpose,
        { trip }
      );
      trip.approvalRequestId = approvalRequest.id;
    } else {
      // Auto-dispatch trip
      this.emit("trip:dispatch", trip);
    }

    this.emit("corporateTrip:created", trip);

    return trip;
  }

  /**
   * Book a trip on behalf of an employee (admin/manager booking)
   */
  async bookForEmployee(
    organizationId: string,
    bookerId: string,
    request: BookForEmployeeRequest
  ): Promise<CorporateTrip> {
    const booker = this.members.get(bookerId);
    if (!booker) {
      throw new Error("Booker not found");
    }

    // Verify booker has permission to book for others
    if (!["OWNER", "ADMIN", "MANAGER", "DISPATCHER"].includes(booker.role)) {
      throw new Error("Not authorized to book for other employees");
    }

    const trip = await this.bookCorporateTrip(
      organizationId,
      request.employeeMemberId,
      request
    );

    trip.bookedById = bookerId;
    trip.bookedByName = `${booker.firstName} ${booker.lastName}`;

    this.corporateTrips.set(trip.id, trip);

    return trip;
  }

  /**
   * Cancel a corporate trip
   */
  async cancelCorporateTrip(
    tripId: string,
    cancelledBy: string,
    reason: string
  ): Promise<CorporateTrip> {
    const trip = this.corporateTrips.get(tripId);
    if (!trip) {
      throw new Error("Trip not found");
    }

    const canceller = this.members.get(cancelledBy);
    if (!canceller) {
      throw new Error("Member not found");
    }

    // Verify permission to cancel
    const canCancel =
      trip.memberId === cancelledBy ||
      this.hasPermission(canceller, "trips:cancel");

    if (!canCancel) {
      throw new Error("Not authorized to cancel this trip");
    }

    trip.status = "cancelled";
    trip.cancelledAt = new Date();
    trip.cancellationReason = reason;

    this.corporateTrips.set(tripId, trip);
    this.emit("corporateTrip:cancelled", { trip, cancelledBy, reason });

    return trip;
  }

  /**
   * Complete a corporate trip (called when trip ends)
   */
  async completeCorporateTrip(
    tripId: string,
    actualCost: number,
    receiptUrl?: string
  ): Promise<CorporateTrip> {
    const trip = this.corporateTrips.get(tripId);
    if (!trip) {
      throw new Error("Trip not found");
    }

    trip.status = "completed";
    trip.actualCost = actualCost;
    trip.completedAt = new Date();
    trip.receiptUrl = receiptUrl;

    this.corporateTrips.set(tripId, trip);

    // Record spending against cost center
    if (trip.costCenterId) {
      await this.recordSpending(trip.costCenterId, actualCost);
    }

    // Update organization balance
    const organization = this.organizations.get(trip.organizationId);
    if (organization) {
      organization.currentBalance += actualCost;
      this.organizations.set(trip.organizationId, organization);
    }

    this.emit("corporateTrip:completed", trip);

    return trip;
  }

  /**
   * Get corporate trip by ID
   */
  async getCorporateTrip(tripId: string): Promise<CorporateTrip | null> {
    return this.corporateTrips.get(tripId) || null;
  }

  /**
   * List corporate trips for an organization
   */
  async listCorporateTrips(
    organizationId: string,
    filters: TripFilters,
    pagination: PaginationParams
  ): Promise<PaginatedResponse<CorporateTrip>> {
    let trips = Array.from(this.corporateTrips.values()).filter(
      (t) => t.organizationId === organizationId
    );

    if (filters.memberId) {
      trips = trips.filter((t) => t.memberId === filters.memberId);
    }
    if (filters.costCenterId) {
      trips = trips.filter((t) => t.costCenterId === filters.costCenterId);
    }
    if (filters.status) {
      trips = trips.filter((t) => t.status === filters.status);
    }
    if (filters.approvalStatus) {
      trips = trips.filter((t) => t.approvalStatus === filters.approvalStatus);
    }
    if (filters.dateFrom) {
      trips = trips.filter((t) => t.createdAt >= filters.dateFrom!);
    }
    if (filters.dateTo) {
      trips = trips.filter((t) => t.createdAt <= filters.dateTo!);
    }

    trips.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return this.paginate(trips, pagination);
  }

  /**
   * Get trips for a specific member
   */
  async getMemberTrips(
    memberId: string,
    pagination: PaginationParams
  ): Promise<PaginatedResponse<CorporateTrip>> {
    const member = this.members.get(memberId);
    if (!member) {
      throw new Error("Member not found");
    }

    return this.listCorporateTrips(
      member.organizationId,
      { memberId },
      pagination
    );
  }

  // ===========================================================================
  // PRIVATE HELPER METHODS
  // ===========================================================================

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  private getDefaultSettings(country: string): OrganizationSettings {
    const currencyMap: Record<string, string> = {
      NG: "NGN",
      ZA: "ZAR",
      KE: "KES",
      GH: "GHS",
      US: "USD",
      GB: "GBP",
    };

    return {
      timezone: "Africa/Lagos",
      currency: currencyMap[country] || "USD",
      language: "en",
      autoApprove: false,
      allowedVehicleTypes: ["standard", "comfort", "executive"],
      requireProjectCode: false,
      ssoEnabled: false,
      notificationPreferences: {
        tripConfirmation: true,
        tripCompletion: true,
        deliveryUpdates: true,
        invoiceGenerated: true,
        paymentReminder: true,
        budgetAlerts: true,
      },
    };
  }

  private calculateInitialCreditLimit(size?: OrganizationSize): number {
    const limits: Record<OrganizationSize, number> = {
      STARTUP: 50000,
      SMALL: 100000,
      MEDIUM: 500000,
      LARGE: 2000000,
      ENTERPRISE: 10000000,
    };
    return limits[size || "SMALL"];
  }

  private async createOwnerMember(
    organizationId: string,
    userId: string,
    email: string
  ): Promise<OrganizationMember> {
    const member: OrganizationMember = {
      id: nanoid(),
      organizationId,
      userId,
      email,
      firstName: "Account",
      lastName: "Owner",
      role: "OWNER",
      permissions: ROLE_PERMISSIONS.OWNER,
      requiresApproval: false,
      status: "ACTIVE",
      invitedAt: new Date(),
      joinedAt: new Date(),
      lastActiveAt: new Date(),
    };

    this.members.set(member.id, member);
    return member;
  }

  private buildCostCenterHierarchy(costCenters: CostCenter[]): CostCenter[] {
    const map = new Map(costCenters.map((c) => [c.id, { ...c, children: [] as CostCenter[] }]));
    const roots: CostCenter[] = [];

    for (const costCenter of map.values()) {
      if (costCenter.parentId) {
        const parent = map.get(costCenter.parentId);
        if (parent) {
          parent.children = parent.children || [];
          (parent.children as CostCenter[]).push(costCenter);
        }
      } else {
        roots.push(costCenter);
      }
    }

    return roots;
  }

  private buildDepartmentHierarchy(departments: Department[]): Department[] {
    const map = new Map(departments.map((d) => [d.id, { ...d, children: [] as Department[] }]));
    const roots: Department[] = [];

    for (const dept of map.values()) {
      if (dept.parentId) {
        const parent = map.get(dept.parentId);
        if (parent) {
          parent.children = parent.children || [];
          (parent.children as Department[]).push(dept);
        }
      } else {
        roots.push(dept);
      }
    }

    return roots;
  }

  private evaluateConditions(
    conditions: ApprovalCondition[],
    tripDetails: Record<string, any>,
    member: OrganizationMember
  ): boolean {
    const context = { ...tripDetails, member };

    for (const condition of conditions) {
      const value = this.getNestedValue(context, condition.field);

      if (!this.evaluateCondition(value, condition.operator, condition.value)) {
        return false;
      }
    }

    return true;
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split(".").reduce((acc, part) => acc?.[part], obj);
  }

  private evaluateCondition(
    actual: any,
    operator: ApprovalCondition["operator"],
    expected: any
  ): boolean {
    switch (operator) {
      case "eq":
        return actual === expected;
      case "ne":
        return actual !== expected;
      case "gt":
        return actual > expected;
      case "gte":
        return actual >= expected;
      case "lt":
        return actual < expected;
      case "lte":
        return actual <= expected;
      case "in":
        return Array.isArray(expected) && expected.includes(actual);
      case "nin":
        return Array.isArray(expected) && !expected.includes(actual);
      case "between":
        return (
          Array.isArray(expected) &&
          actual >= expected[0] &&
          actual <= expected[1]
        );
      default:
        return false;
    }
  }

  private async estimateTripCost(
    pickup?: { lat: number; lng: number },
    dropoff?: { lat: number; lng: number },
    vehicleType: string = "standard"
  ): Promise<number> {
    // Simplified cost estimation
    const baseRate: Record<string, number> = {
      standard: 500,
      comfort: 800,
      executive: 1500,
      suv: 1200,
    };

    const base = baseRate[vehicleType] || 500;
    const perKm = 50;

    if (!pickup || !dropoff) {
      return base;
    }

    // Simple Haversine distance
    const R = 6371;
    const dLat = ((dropoff.lat - pickup.lat) * Math.PI) / 180;
    const dLng = ((dropoff.lng - pickup.lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((pickup.lat * Math.PI) / 180) *
        Math.cos((dropoff.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return Math.round(base + distance * perKm);
  }

  private paginate<T>(
    items: T[],
    params: PaginationParams
  ): PaginatedResponse<T> {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const total = items.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const end = start + limit;

    return {
      data: items.slice(start, end),
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const corporateAccountsService = new CorporateAccountsService();
