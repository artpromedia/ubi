/**
 * UBI School Transport Service (UBI Connect - Education)
 *
 * Comprehensive school transportation management:
 * - Route planning and optimization
 * - Student pickup/dropoff tracking
 * - Real-time parent notifications
 * - Guardian verification
 * - Attendance tracking
 * - Field trip management
 */

import crypto from "crypto";
import { EventEmitter } from "events";
import type {
  ActiveSchoolRoute,
  Coordinates,
  Guardian,
  PaginatedResponse,
  PaginationParams,
  RouteStop,
  School,
  SchoolRoute,
  SchoolRouteType,
  SchoolSettings,
  Student,
  StudentLocation,
  StudentTripLog,
} from "../types/b2b.types";

// =============================================================================
// INTERFACES
// =============================================================================

interface SchoolTerm {
  id: string;
  schoolId: string;
  name: string;
  startDate: Date;
  endDate: Date;
  holidays: { date: Date; name: string }[];
  isActive: boolean;
}

interface RouteAssignment {
  studentId: string;
  routeId: string;
  stopOrder: number;
  effectiveFrom: Date;
  effectiveUntil?: Date;
  isActive: boolean;
}

interface ParentNotification {
  id: string;
  studentId: string;
  parentUserId: string;
  type:
    | "pickup_soon"
    | "picked_up"
    | "dropoff_soon"
    | "dropped_off"
    | "delay"
    | "emergency"
    | "absent";
  message: string;
  routeId?: string;
  sentAt: Date;
  readAt?: Date;
}

interface RouteOptimizationResult {
  optimizedStops: RouteStop[];
  estimatedDuration: number;
  totalDistance: number;
  savingsMinutes: number;
}

interface AttendanceRecord {
  id: string;
  studentId: string;
  date: Date;
  morningStatus: "present" | "absent" | "late";
  afternoonStatus: "present" | "absent" | "early_pickup";
  morningRouteId?: string;
  afternoonRouteId?: string;
  notes?: string;
}

interface StudentFilters {
  grade?: string;
  className?: string;
  routeId?: string;
  subscriptionStatus?: Student["subscriptionStatus"];
  subscriptionType?: Student["subscriptionType"];
}

// =============================================================================
// SCHOOL TRANSPORT SERVICE
// =============================================================================

export class SchoolTransportService extends EventEmitter {
  private schools: Map<string, School> = new Map();
  private terms: Map<string, SchoolTerm> = new Map();
  private students: Map<string, Student> = new Map();
  private routes: Map<string, SchoolRoute> = new Map();
  private activeRoutes: Map<string, ActiveSchoolRoute> = new Map();
  private tripLogs: Map<string, StudentTripLog[]> = new Map();
  private routeAssignments: Map<string, RouteAssignment[]> = new Map();
  private notifications: Map<string, ParentNotification[]> = new Map();
  private attendance: Map<string, AttendanceRecord[]> = new Map();

  constructor() {
    super();
    this.setMaxListeners(100);
  }

  // ===========================================================================
  // SCHOOL MANAGEMENT
  // ===========================================================================

  /**
   * Register a school
   */
  async registerSchool(
    organizationId: string,
    schoolData: {
      schoolType: School["schoolType"];
      address: string;
      coordinates: Coordinates;
      gateLocations?: Coordinates[];
      startTime: string;
      endTime: string;
      timezone?: string;
      operatingDays?: number[];
      settings?: Partial<SchoolSettings>;
    }
  ): Promise<School> {
    const school: School = {
      id: `school_${crypto.randomBytes(12).toString("hex")}`,
      organizationId,
      schoolType: schoolData.schoolType,
      address: schoolData.address,
      coordinates: schoolData.coordinates,
      gateLocations: schoolData.gateLocations || [schoolData.coordinates],
      startTime: schoolData.startTime,
      endTime: schoolData.endTime,
      timezone: schoolData.timezone || "Africa/Lagos",
      operatingDays: schoolData.operatingDays || [1, 2, 3, 4, 5], // Mon-Fri
      settings: {
        requirePhotoVerification:
          schoolData.settings?.requirePhotoVerification ?? true,
        allowThirdPartyPickup:
          schoolData.settings?.allowThirdPartyPickup ?? false,
        maxPickupRadius: schoolData.settings?.maxPickupRadius ?? 50, // meters
        parentNotifications: schoolData.settings?.parentNotifications ?? true,
        absenteeNotifications:
          schoolData.settings?.absenteeNotifications ?? true,
      },
    };

    this.schools.set(school.id, school);
    this.emit("school:registered", school);

    return school;
  }

  /**
   * Update school settings
   */
  async updateSchool(
    schoolId: string,
    updates: Partial<School>
  ): Promise<School> {
    const school = this.schools.get(schoolId);
    if (!school) {
      throw new Error("School not found");
    }

    Object.assign(school, updates);
    if (updates.settings) {
      school.settings = { ...school.settings, ...updates.settings };
    }

    this.schools.set(schoolId, school);

    return school;
  }

  /**
   * Get school by ID
   */
  async getSchool(schoolId: string): Promise<School | null> {
    return this.schools.get(schoolId) || null;
  }

  /**
   * Create school term
   */
  async createTerm(
    schoolId: string,
    term: {
      name: string;
      startDate: Date;
      endDate: Date;
      holidays?: { date: Date; name: string }[];
    }
  ): Promise<SchoolTerm> {
    const schoolTerm: SchoolTerm = {
      id: `term_${crypto.randomBytes(12).toString("hex")}`,
      schoolId,
      name: term.name,
      startDate: term.startDate,
      endDate: term.endDate,
      holidays: term.holidays || [],
      isActive: false,
    };

    this.terms.set(schoolTerm.id, schoolTerm);

    return schoolTerm;
  }

  /**
   * Activate a term
   */
  async activateTerm(termId: string): Promise<SchoolTerm> {
    const term = this.terms.get(termId);
    if (!term) {
      throw new Error("Term not found");
    }

    // Deactivate other terms for this school
    for (const [id, t] of this.terms) {
      if (t.schoolId === term.schoolId && t.isActive) {
        t.isActive = false;
        this.terms.set(id, t);
      }
    }

    term.isActive = true;
    this.terms.set(termId, term);

    return term;
  }

  // ===========================================================================
  // STUDENT MANAGEMENT
  // ===========================================================================

  /**
   * Register a student
   */
  async registerStudent(
    schoolId: string,
    studentData: {
      studentId: string;
      firstName: string;
      lastName: string;
      dateOfBirth?: Date;
      grade?: string;
      className?: string;
      photoUrl?: string;
      homeAddress: string;
      homeCoordinates: Coordinates;
      pickupPointAddress?: string;
      pickupPointCoordinates?: Coordinates;
      pickupPointNotes?: string;
      guardians: Omit<Guardian, "userId">[];
      specialNeeds?: string;
      medicalNotes?: string;
      subscriptionType: Student["subscriptionType"];
    }
  ): Promise<Student> {
    const school = this.schools.get(schoolId);
    if (!school) {
      throw new Error("School not found");
    }

    const student: Student = {
      id: `student_${crypto.randomBytes(12).toString("hex")}`,
      schoolId,
      studentId: studentData.studentId,
      firstName: studentData.firstName,
      lastName: studentData.lastName,
      dateOfBirth: studentData.dateOfBirth,
      grade: studentData.grade,
      className: studentData.className,
      photoUrl: studentData.photoUrl,
      homeAddress: studentData.homeAddress,
      homeCoordinates: studentData.homeCoordinates,
      pickupPointAddress:
        studentData.pickupPointAddress || studentData.homeAddress,
      pickupPointCoordinates:
        studentData.pickupPointCoordinates || studentData.homeCoordinates,
      pickupPointNotes: studentData.pickupPointNotes,
      guardians: studentData.guardians.map((g) => ({
        ...g,
        userId: undefined,
      })),
      specialNeeds: studentData.specialNeeds,
      medicalNotes: studentData.medicalNotes,
      subscriptionStatus: "active",
      subscriptionType: studentData.subscriptionType,
      isActive: true,
    };

    this.students.set(student.id, student);

    // Update school student count
    school.studentCount = (school.studentCount || 0) + 1;
    this.schools.set(schoolId, school);

    this.emit("student:registered", student);

    return student;
  }

  /**
   * Update student details
   */
  async updateStudent(
    studentId: string,
    updates: Partial<Student>
  ): Promise<Student> {
    const student = this.students.get(studentId);
    if (!student) {
      throw new Error("Student not found");
    }

    Object.assign(student, updates);
    this.students.set(studentId, student);

    return student;
  }

  /**
   * Add guardian to student
   */
  async addGuardian(studentId: string, guardian: Guardian): Promise<Student> {
    const student = this.students.get(studentId);
    if (!student) {
      throw new Error("Student not found");
    }

    student.guardians.push(guardian);
    this.students.set(studentId, student);

    return student;
  }

  /**
   * Remove guardian from student
   */
  async removeGuardian(
    studentId: string,
    guardianPhone: string
  ): Promise<Student> {
    const student = this.students.get(studentId);
    if (!student) {
      throw new Error("Student not found");
    }

    student.guardians = student.guardians.filter(
      (g) => g.phone !== guardianPhone
    );
    this.students.set(studentId, student);

    return student;
  }

  /**
   * Get student by ID
   */
  async getStudent(studentId: string): Promise<Student | null> {
    return this.students.get(studentId) || null;
  }

  /**
   * List students for a school
   */
  async listStudents(
    schoolId: string,
    filters: StudentFilters,
    pagination: PaginationParams
  ): Promise<PaginatedResponse<Student>> {
    let students = Array.from(this.students.values()).filter(
      (s) => s.schoolId === schoolId && s.isActive
    );

    if (filters.grade) {
      students = students.filter((s) => s.grade === filters.grade);
    }
    if (filters.className) {
      students = students.filter((s) => s.className === filters.className);
    }
    if (filters.subscriptionStatus) {
      students = students.filter(
        (s) => s.subscriptionStatus === filters.subscriptionStatus
      );
    }
    if (filters.subscriptionType) {
      students = students.filter(
        (s) => s.subscriptionType === filters.subscriptionType
      );
    }
    if (filters.routeId) {
      const assignments = this.routeAssignments.get(filters.routeId) || [];
      const studentIds = new Set(
        assignments.filter((a) => a.isActive).map((a) => a.studentId)
      );
      students = students.filter((s) => studentIds.has(s.id));
    }

    students.sort((a, b) => a.lastName.localeCompare(b.lastName));

    return this.paginate(students, pagination);
  }

  /**
   * Pause student subscription
   */
  async pauseSubscription(
    studentId: string,
    reason?: string
  ): Promise<Student> {
    const student = this.students.get(studentId);
    if (!student) {
      throw new Error("Student not found");
    }

    student.subscriptionStatus = "paused";
    this.students.set(studentId, student);

    this.emit("student:subscription_paused", { student, reason });

    return student;
  }

  /**
   * Resume student subscription
   */
  async resumeSubscription(studentId: string): Promise<Student> {
    const student = this.students.get(studentId);
    if (!student) {
      throw new Error("Student not found");
    }

    student.subscriptionStatus = "active";
    this.students.set(studentId, student);

    return student;
  }

  // ===========================================================================
  // ROUTE MANAGEMENT
  // ===========================================================================

  /**
   * Create a school route
   */
  async createRoute(
    schoolId: string,
    routeData: {
      name: string;
      type: SchoolRouteType;
      stops: RouteStop[];
      startTime?: string;
    }
  ): Promise<SchoolRoute> {
    const route: SchoolRoute = {
      id: `route_${crypto.randomBytes(12).toString("hex")}`,
      schoolId,
      name: routeData.name,
      type: routeData.type,
      stops: routeData.stops,
      startTime: routeData.startTime,
      studentCount: 0,
      isActive: true,
    };

    // Calculate estimated duration
    route.estimatedDurationMins = this.calculateRouteDuration(route.stops);

    this.routes.set(route.id, route);
    this.routeAssignments.set(route.id, []);

    this.emit("route:created", route);

    return route;
  }

  /**
   * Update route
   */
  async updateRoute(
    routeId: string,
    updates: Partial<SchoolRoute>
  ): Promise<SchoolRoute> {
    const route = this.routes.get(routeId);
    if (!route) {
      throw new Error("Route not found");
    }

    Object.assign(route, updates);

    if (updates.stops) {
      route.estimatedDurationMins = this.calculateRouteDuration(route.stops);
    }

    this.routes.set(routeId, route);

    return route;
  }

  /**
   * Assign student to route
   */
  async assignStudentToRoute(
    studentId: string,
    routeId: string,
    stopOrder: number
  ): Promise<void> {
    const student = this.students.get(studentId);
    if (!student) {
      throw new Error("Student not found");
    }

    const route = this.routes.get(routeId);
    if (!route) {
      throw new Error("Route not found");
    }

    const assignments = this.routeAssignments.get(routeId) || [];

    // Deactivate existing assignment
    for (const assignment of assignments) {
      if (assignment.studentId === studentId && assignment.isActive) {
        assignment.isActive = false;
      }
    }

    // Create new assignment
    assignments.push({
      studentId,
      routeId,
      stopOrder,
      effectiveFrom: new Date(),
      isActive: true,
    });

    this.routeAssignments.set(routeId, assignments);

    // Update route stop with student
    const stop = route.stops.find((s) => s.order === stopOrder);
    if (stop && !stop.studentIds.includes(studentId)) {
      stop.studentIds.push(studentId);
    }

    route.studentCount = assignments.filter((a) => a.isActive).length;
    this.routes.set(routeId, route);

    this.emit("student:route_assigned", { student, route, stopOrder });
  }

  /**
   * Remove student from route
   */
  async removeStudentFromRoute(
    studentId: string,
    routeId: string
  ): Promise<void> {
    const assignments = this.routeAssignments.get(routeId) || [];

    for (const assignment of assignments) {
      if (assignment.studentId === studentId && assignment.isActive) {
        assignment.isActive = false;
        assignment.effectiveUntil = new Date();
      }
    }

    this.routeAssignments.set(routeId, assignments);

    const route = this.routes.get(routeId);
    if (route) {
      for (const stop of route.stops) {
        stop.studentIds = stop.studentIds.filter((id) => id !== studentId);
      }
      route.studentCount = assignments.filter((a) => a.isActive).length;
      this.routes.set(routeId, route);
    }
  }

  /**
   * Optimize route
   */
  async optimizeRoute(routeId: string): Promise<RouteOptimizationResult> {
    const route = this.routes.get(routeId);
    if (!route) {
      throw new Error("Route not found");
    }

    const originalDuration = this.calculateRouteDuration(route.stops);

    // Simple nearest-neighbor optimization
    const optimizedStops = this.optimizeStopOrder(route.stops);
    const optimizedDuration = this.calculateRouteDuration(optimizedStops);
    const totalDistance = this.calculateTotalDistance(optimizedStops);

    return {
      optimizedStops,
      estimatedDuration: optimizedDuration,
      totalDistance,
      savingsMinutes: originalDuration - optimizedDuration,
    };
  }

  /**
   * Apply route optimization
   */
  async applyRouteOptimization(
    routeId: string,
    optimizedStops: RouteStop[]
  ): Promise<SchoolRoute> {
    const route = this.routes.get(routeId);
    if (!route) {
      throw new Error("Route not found");
    }

    route.stops = optimizedStops;
    route.estimatedDurationMins = this.calculateRouteDuration(optimizedStops);

    this.routes.set(routeId, route);

    return route;
  }

  /**
   * Get route by ID
   */
  async getRoute(routeId: string): Promise<SchoolRoute | null> {
    return this.routes.get(routeId) || null;
  }

  /**
   * List routes for a school
   */
  async listRoutes(
    schoolId: string,
    type?: SchoolRouteType
  ): Promise<SchoolRoute[]> {
    let routes = Array.from(this.routes.values()).filter(
      (r) => r.schoolId === schoolId && r.isActive
    );

    if (type) {
      routes = routes.filter((r) => r.type === type);
    }

    return routes;
  }

  /**
   * Get students on a route
   */
  async getRouteStudents(routeId: string): Promise<Student[]> {
    const assignments = this.routeAssignments.get(routeId) || [];
    const activeAssignments = assignments.filter((a) => a.isActive);

    const students: Student[] = [];
    for (const assignment of activeAssignments) {
      const student = this.students.get(assignment.studentId);
      if (student) {
        students.push(student);
      }
    }

    return students;
  }

  // ===========================================================================
  // ACTIVE ROUTE TRACKING
  // ===========================================================================

  /**
   * Start a route
   */
  async startRoute(
    routeId: string,
    driverId: string,
    driverName: string,
    driverPhone: string,
    vehiclePlate: string
  ): Promise<ActiveSchoolRoute> {
    const route = this.routes.get(routeId);
    if (!route) {
      throw new Error("Route not found");
    }

    const students = await this.getRouteStudents(routeId);

    const activeRoute: ActiveSchoolRoute = {
      id: `active_route_${crypto.randomBytes(12).toString("hex")}`,
      routeId,
      routeName: route.name,
      date: new Date(),
      driverId,
      driverName,
      driverPhone,
      vehiclePlate,
      status: "in_progress",
      currentStopIndex: 0,
      studentsExpected: students.length,
      studentsPickedUp: 0,
      studentsDroppedOff: 0,
      studentsAbsent: 0,
      startedAt: new Date(),
    };

    this.activeRoutes.set(activeRoute.id, activeRoute);
    this.tripLogs.set(activeRoute.id, []);

    // Notify parents that route has started
    await this.notifyRouteStarted(activeRoute, students);

    this.emit("route:started", activeRoute);

    return activeRoute;
  }

  /**
   * Update driver location
   */
  async updateDriverLocation(
    activeRouteId: string,
    location: Coordinates
  ): Promise<ActiveSchoolRoute> {
    const activeRoute = this.activeRoutes.get(activeRouteId);
    if (!activeRoute) {
      throw new Error("Active route not found");
    }

    activeRoute.currentLocation = location;

    // Calculate ETA for next stop
    const route = this.routes.get(activeRoute.routeId);
    if (route && route.stops[activeRoute.currentStopIndex]) {
      const nextStop = route.stops[activeRoute.currentStopIndex];
      if (nextStop) {
        const etaMins = this.calculateETA(location, nextStop.coordinates);
        activeRoute.estimatedArrival = new Date(Date.now() + etaMins * 60 * 1000);
      }
    }

    this.activeRoutes.set(activeRouteId, activeRoute);

    this.emit("route:location_updated", {
      activeRoute,
      location,
    });

    return activeRoute;
  }

  /**
   * Record student pickup
   */
  async recordStudentPickup(
    activeRouteId: string,
    studentId: string,
    verificationMethod: StudentTripLog["verificationMethod"],
    photoUrl?: string
  ): Promise<StudentTripLog> {
    const activeRoute = this.activeRoutes.get(activeRouteId);
    if (!activeRoute) {
      throw new Error("Active route not found");
    }

    const student = this.students.get(studentId);
    if (!student) {
      throw new Error("Student not found");
    }

    const log: StudentTripLog = {
      id: `log_${crypto.randomBytes(12).toString("hex")}`,
      activeRouteId,
      studentId,
      studentName: `${student.firstName} ${student.lastName}`,
      eventType: "pickup",
      location: activeRoute.currentLocation,
      timestamp: new Date(),
      verificationMethod,
      photoUrl,
    };

    const logs = this.tripLogs.get(activeRouteId) || [];
    logs.push(log);
    this.tripLogs.set(activeRouteId, logs);

    activeRoute.studentsPickedUp++;
    this.activeRoutes.set(activeRouteId, activeRoute);

    // Notify guardians
    await this.notifyGuardians(student, "picked_up", activeRoute);
    log.guardianNotifiedAt = new Date();

    this.emit("student:picked_up", { log, activeRoute, student });

    return log;
  }

  /**
   * Record student dropoff
   */
  async recordStudentDropoff(
    activeRouteId: string,
    studentId: string,
    verificationMethod: StudentTripLog["verificationMethod"],
    photoUrl?: string
  ): Promise<StudentTripLog> {
    const activeRoute = this.activeRoutes.get(activeRouteId);
    if (!activeRoute) {
      throw new Error("Active route not found");
    }

    const student = this.students.get(studentId);
    if (!student) {
      throw new Error("Student not found");
    }

    const log: StudentTripLog = {
      id: `log_${crypto.randomBytes(12).toString("hex")}`,
      activeRouteId,
      studentId,
      studentName: `${student.firstName} ${student.lastName}`,
      eventType: "dropoff",
      location: activeRoute.currentLocation,
      timestamp: new Date(),
      verificationMethod,
      photoUrl,
    };

    const logs = this.tripLogs.get(activeRouteId) || [];
    logs.push(log);
    this.tripLogs.set(activeRouteId, logs);

    activeRoute.studentsDroppedOff++;
    this.activeRoutes.set(activeRouteId, activeRoute);

    // Notify guardians
    await this.notifyGuardians(student, "dropped_off", activeRoute);
    log.guardianNotifiedAt = new Date();

    this.emit("student:dropped_off", { log, activeRoute, student });

    return log;
  }

  /**
   * Mark student absent
   */
  async markStudentAbsent(
    activeRouteId: string,
    studentId: string,
    notes?: string
  ): Promise<StudentTripLog> {
    const activeRoute = this.activeRoutes.get(activeRouteId);
    if (!activeRoute) {
      throw new Error("Active route not found");
    }

    const student = this.students.get(studentId);
    if (!student) {
      throw new Error("Student not found");
    }

    const log: StudentTripLog = {
      id: `log_${crypto.randomBytes(12).toString("hex")}`,
      activeRouteId,
      studentId,
      studentName: `${student.firstName} ${student.lastName}`,
      eventType: "absent",
      timestamp: new Date(),
      notes,
    };

    const logs = this.tripLogs.get(activeRouteId) || [];
    logs.push(log);
    this.tripLogs.set(activeRouteId, logs);

    activeRoute.studentsAbsent++;
    this.activeRoutes.set(activeRouteId, activeRoute);

    // Notify school and guardians
    await this.notifyGuardians(student, "absent", activeRoute);

    this.emit("student:absent", { log, activeRoute, student });

    return log;
  }

  /**
   * Move to next stop
   */
  async moveToNextStop(activeRouteId: string): Promise<ActiveSchoolRoute> {
    const activeRoute = this.activeRoutes.get(activeRouteId);
    if (!activeRoute) {
      throw new Error("Active route not found");
    }

    const route = this.routes.get(activeRoute.routeId);
    if (!route) {
      throw new Error("Route not found");
    }

    activeRoute.currentStopIndex++;

    // Notify parents at next stop
    if (activeRoute.currentStopIndex < route.stops.length) {
      const nextStop = route.stops[activeRoute.currentStopIndex];
      if (nextStop) {
        await this.notifyUpcomingStop(activeRoute, nextStop);
      }
    }

    this.activeRoutes.set(activeRouteId, activeRoute);

    return activeRoute;
  }

  /**
   * Complete route
   */
  async completeRoute(activeRouteId: string): Promise<ActiveSchoolRoute> {
    const activeRoute = this.activeRoutes.get(activeRouteId);
    if (!activeRoute) {
      throw new Error("Active route not found");
    }

    activeRoute.status = "completed";
    activeRoute.completedAt = new Date();

    this.activeRoutes.set(activeRouteId, activeRoute);

    // Record attendance
    await this.recordAttendanceFromRoute(activeRoute);

    this.emit("route:completed", activeRoute);

    return activeRoute;
  }

  /**
   * Get active route status
   */
  async getActiveRoute(
    activeRouteId: string
  ): Promise<ActiveSchoolRoute | null> {
    return this.activeRoutes.get(activeRouteId) || null;
  }

  /**
   * Get current active routes for a school
   */
  async getActiveRoutesForSchool(
    schoolId: string
  ): Promise<ActiveSchoolRoute[]> {
    const schoolRoutes = Array.from(this.routes.values())
      .filter((r) => r.schoolId === schoolId)
      .map((r) => r.id);

    return Array.from(this.activeRoutes.values()).filter(
      (ar) => schoolRoutes.includes(ar.routeId) && ar.status === "in_progress"
    );
  }

  // ===========================================================================
  // PARENT FEATURES
  // ===========================================================================

  /**
   * Get student's current location/status
   */
  async getStudentLocation(studentId: string): Promise<StudentLocation> {
    const student = this.students.get(studentId);
    if (!student) {
      throw new Error("Student not found");
    }

    // Find active route for this student
    const assignments = Array.from(this.routeAssignments.values())
      .flat()
      .filter((a) => a.studentId === studentId && a.isActive);

    for (const assignment of assignments) {
      const activeRoute = Array.from(this.activeRoutes.values()).find(
        (ar) => ar.routeId === assignment.routeId && ar.status === "in_progress"
      );

      if (activeRoute) {
        // Check if student has been picked up
        const logs = this.tripLogs.get(activeRoute.id) || [];
        const studentLogs = logs.filter((l) => l.studentId === studentId);

        const pickedUp = studentLogs.some((l) => l.eventType === "pickup");
        const droppedOff = studentLogs.some((l) => l.eventType === "dropoff");

        if (droppedOff) {
          return { status: "dropped_off", lastUpdated: new Date() };
        }

        if (pickedUp) {
          return {
            status: "picked_up",
            vehicleLocation: activeRoute.currentLocation,
            estimatedArrival: activeRoute.estimatedArrival,
            driverName: activeRoute.driverName,
            driverPhone: activeRoute.driverPhone,
            vehiclePlate: activeRoute.vehiclePlate,
            lastUpdated: new Date(),
          };
        }

        return {
          status: "waiting_pickup",
          vehicleLocation: activeRoute.currentLocation,
          estimatedArrival: activeRoute.estimatedArrival,
          driverName: activeRoute.driverName,
          driverPhone: activeRoute.driverPhone,
          vehiclePlate: activeRoute.vehiclePlate,
          lastUpdated: new Date(),
        };
      }
    }

    return { status: "not_in_transit" };
  }

  /**
   * Get trip history for a student
   */
  async getStudentTripHistory(
    studentId: string,
    dateFrom?: Date,
    dateTo?: Date
  ): Promise<StudentTripLog[]> {
    const allLogs: StudentTripLog[] = [];

    for (const [, logs] of this.tripLogs) {
      const studentLogs = logs.filter((l) => l.studentId === studentId);
      allLogs.push(...studentLogs);
    }

    let filteredLogs = allLogs;

    if (dateFrom) {
      filteredLogs = filteredLogs.filter((l) => l.timestamp >= dateFrom);
    }
    if (dateTo) {
      filteredLogs = filteredLogs.filter((l) => l.timestamp <= dateTo);
    }

    return filteredLogs.sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
    );
  }

  /**
   * Parent marks child as absent
   */
  async markChildAbsentByParent(
    studentId: string,
    parentUserId: string,
    date: Date,
    tripType: "morning" | "afternoon" | "both",
    reason?: string
  ): Promise<void> {
    const student = this.students.get(studentId);
    if (!student) {
      throw new Error("Student not found");
    }

    // Verify parent is authorized
    const isAuthorized = student.guardians.some(
      (g) => g.userId === parentUserId
    );
    if (!isAuthorized) {
      throw new Error("Not authorized for this student");
    }

    // Record absence
    const dateKey = date.toISOString().split("T")[0];
    const records = this.attendance.get(studentId) || [];

    let record = records.find(
      (r) => r.date.toISOString().split("T")[0] === dateKey
    );

    if (!record) {
      record = {
        id: `attendance_${crypto.randomBytes(12).toString("hex")}`,
        studentId,
        date,
        morningStatus: "present",
        afternoonStatus: "present",
        notes: reason,
      };
      records.push(record);
    }

    if (tripType === "morning" || tripType === "both") {
      record.morningStatus = "absent";
    }
    if (tripType === "afternoon" || tripType === "both") {
      record.afternoonStatus = "absent";
    }

    this.attendance.set(studentId, records);

    this.emit("student:marked_absent_by_parent", {
      student,
      date,
      tripType,
      reason,
    });
  }

  // ===========================================================================
  // NOTIFICATIONS
  // ===========================================================================

  private async notifyRouteStarted(
    activeRoute: ActiveSchoolRoute,
    students: Student[]
  ): Promise<void> {
    for (const student of students) {
      await this.notifyGuardians(
        student,
        "pickup_soon",
        activeRoute,
        `School bus has started the route. Estimated arrival at your stop soon.`
      );
    }
  }

  private async notifyUpcomingStop(
    activeRoute: ActiveSchoolRoute,
    stop: RouteStop
  ): Promise<void> {
    for (const studentId of stop.studentIds) {
      const student = this.students.get(studentId);
      if (student) {
        await this.notifyGuardians(
          student,
          "pickup_soon",
          activeRoute,
          `Bus arriving at stop in approximately ${stop.waitTimeMinutes} minutes`
        );
      }
    }
  }

  private async notifyGuardians(
    student: Student,
    type: ParentNotification["type"],
    activeRoute: ActiveSchoolRoute,
    customMessage?: string
  ): Promise<void> {
    const messages: Record<ParentNotification["type"], string> = {
      pickup_soon: `${student.firstName} will be picked up soon`,
      picked_up: `${student.firstName} has been picked up`,
      dropoff_soon: `${student.firstName} will be dropped off soon`,
      dropped_off: `${student.firstName} has been dropped off`,
      delay: `Bus delay alert for ${student.firstName}'s route`,
      emergency: `Emergency alert for ${student.firstName}'s route`,
      absent: `${student.firstName} was marked absent from the bus`,
    };

    for (const guardian of student.guardians) {
      if (!guardian.userId) continue;

      const notification: ParentNotification = {
        id: `notif_${crypto.randomBytes(12).toString("hex")}`,
        studentId: student.id,
        parentUserId: guardian.userId,
        type,
        message: customMessage || messages[type],
        routeId: activeRoute.routeId,
        sentAt: new Date(),
      };

      const notifications = this.notifications.get(guardian.userId) || [];
      notifications.push(notification);
      this.notifications.set(guardian.userId, notifications);

      this.emit("notification:sent", notification);
    }
  }

  // ===========================================================================
  // ANALYTICS
  // ===========================================================================

  /**
   * Get school transport statistics
   */
  async getSchoolStats(
    schoolId: string,
    dateFrom: Date,
    dateTo: Date
  ): Promise<{
    totalStudents: number;
    activeSubscriptions: number;
    totalRoutes: number;
    tripsCompleted: number;
    totalPickups: number;
    totalDropoffs: number;
    absentCount: number;
    onTimeRate: number;
    averageRouteTime: number;
  }> {
    const students = Array.from(this.students.values()).filter(
      (s) => s.schoolId === schoolId
    );

    const routes = Array.from(this.routes.values()).filter(
      (r) => r.schoolId === schoolId
    );

    const completedRoutes = Array.from(this.activeRoutes.values()).filter(
      (ar) =>
        routes.some((r) => r.id === ar.routeId) &&
        ar.status === "completed" &&
        ar.completedAt &&
        ar.completedAt >= dateFrom &&
        ar.completedAt <= dateTo
    );

    let totalPickups = 0;
    let totalDropoffs = 0;
    let absentCount = 0;
    let totalRouteTime = 0;

    for (const activeRoute of completedRoutes) {
      totalPickups += activeRoute.studentsPickedUp;
      totalDropoffs += activeRoute.studentsDroppedOff;
      absentCount += activeRoute.studentsAbsent;

      if (activeRoute.startedAt && activeRoute.completedAt) {
        totalRouteTime +=
          activeRoute.completedAt.getTime() - activeRoute.startedAt.getTime();
      }
    }

    return {
      totalStudents: students.length,
      activeSubscriptions: students.filter(
        (s) => s.subscriptionStatus === "active"
      ).length,
      totalRoutes: routes.length,
      tripsCompleted: completedRoutes.length,
      totalPickups,
      totalDropoffs,
      absentCount,
      onTimeRate: 95, // Calculate from actual data
      averageRouteTime:
        completedRoutes.length > 0
          ? Math.round(totalRouteTime / completedRoutes.length / 60000)
          : 0,
    };
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private calculateRouteDuration(stops: RouteStop[]): number {
    let totalMinutes = 0;

    for (let i = 0; i < stops.length - 1; i++) {
      const currentStop = stops[i];
      const nextStop = stops[i + 1];
      if (currentStop && nextStop) {
        // Travel time between stops
        const distance = this.calculateDistance(
          currentStop.coordinates,
          nextStop.coordinates
        );
        totalMinutes += Math.ceil(distance * 3); // ~3 min per km
        // Wait time at stop
        totalMinutes += currentStop.waitTimeMinutes;
      }
    }

    return totalMinutes;
  }

  private calculateTotalDistance(stops: RouteStop[]): number {
    let totalKm = 0;

    for (let i = 0; i < stops.length - 1; i++) {
      const currentStop = stops[i];
      const nextStop = stops[i + 1];
      if (currentStop && nextStop) {
        totalKm += this.calculateDistance(
          currentStop.coordinates,
          nextStop.coordinates
        );
      }
    }

    return Math.round(totalKm * 10) / 10;
  }

  private calculateDistance(from: Coordinates, to: Coordinates): number {
    const R = 6371;
    const dLat = this.toRad(to.lat - from.lat);
    const dLng = this.toRad(to.lng - from.lng);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.toRad(from.lat)) *
        Math.cos(this.toRad(to.lat)) *
        Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  private calculateETA(from: Coordinates, to: Coordinates): number {
    const distance = this.calculateDistance(from, to);
    return Math.ceil(distance * 3); // ~3 min per km
  }

  private optimizeStopOrder(stops: RouteStop[]): RouteStop[] {
    if (stops.length <= 2) return stops;

    const firstStop = stops[0];
    if (!firstStop) return stops;

    // Simple nearest-neighbor algorithm
    const optimized: RouteStop[] = [firstStop];
    const remaining = stops.slice(1);

    while (remaining.length > 0) {
      const lastStop = optimized[optimized.length - 1];
      if (!lastStop) break;

      let nearestIdx = 0;
      let nearestDist = Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const currentRemaining = remaining[i];
        if (currentRemaining) {
          const dist = this.calculateDistance(
            lastStop.coordinates,
            currentRemaining.coordinates
          );
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestIdx = i;
          }
        }
      }

      const nearestStop = remaining.splice(nearestIdx, 1)[0];
      if (nearestStop) {
        optimized.push(nearestStop);
      }
    }

    // Update order numbers
    return optimized.map((stop, idx) => ({
      ...stop,
      order: idx + 1,
    }));
  }

  private async recordAttendanceFromRoute(
    activeRoute: ActiveSchoolRoute
  ): Promise<void> {
    const logs = this.tripLogs.get(activeRoute.id) || [];
    const route = this.routes.get(activeRoute.routeId);

    if (!route) return;

    const dateKey = activeRoute.date.toISOString().split("T")[0];

    for (const log of logs) {
      const records = this.attendance.get(log.studentId) || [];
      let record = records.find(
        (r) => r.date.toISOString().split("T")[0] === dateKey
      );

      if (!record) {
        record = {
          id: `attendance_${crypto.randomBytes(12).toString("hex")}`,
          studentId: log.studentId,
          date: activeRoute.date,
          morningStatus: "present",
          afternoonStatus: "present",
        };
        records.push(record);
      }

      if (route.type === "MORNING_PICKUP") {
        record.morningStatus =
          log.eventType === "absent" ? "absent" : "present";
        record.morningRouteId = activeRoute.id;
      } else if (route.type === "AFTERNOON_DROPOFF") {
        record.afternoonStatus =
          log.eventType === "absent" ? "absent" : "present";
        record.afternoonRouteId = activeRoute.id;
      }

      this.attendance.set(log.studentId, records);
    }
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

export const schoolTransportService = new SchoolTransportService();
