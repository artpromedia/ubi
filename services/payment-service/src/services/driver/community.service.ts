// ===========================================
// UBI Driver Experience Platform
// Community & Social Service
// ===========================================

import {
  DRIVER_EVENTS,
  DriverEvent,
  DriverLeaderboard,
  EventRegistration,
  EventType,
  ForumCategory,
  ForumComment,
  ForumPost,
  LeaderboardEntry,
  LeaderboardPeriod,
  MentorshipPair,
  MentorshipStatus,
  PostType,
  RegistrationStatus,
} from "../../types/driver.types";

// -----------------------------------------
// COMMUNITY SERVICE
// -----------------------------------------

export class CommunityService {
  // private _eventEmitter: EventEmitter;
  // private _cache: Map<string, { data: unknown; expiry: number }> = new Map();

  constructor(
    private readonly db: any,
    private readonly redis: any,
    private readonly notificationService: any,
    private readonly analyticsService: any,
  ) {}

  // -----------------------------------------
  // FORUM - CATEGORIES
  // -----------------------------------------

  async getForumCategories(): Promise<ForumCategory[]> {
    const categories = await this.db.forumCategory.findMany({
      where: { isActive: true },
      orderBy: { orderIndex: "asc" },
    });

    return Promise.all(
      categories.map(async (c: any) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        slug: c.slug,
        iconUrl: c.iconUrl,
        postCount: await this.db.forumPost.count({
          where: { categoryId: c.id },
        }),
        isActive: c.isActive,
        orderIndex: c.orderIndex,
      })),
    );
  }

  // -----------------------------------------
  // FORUM - POSTS
  // -----------------------------------------

  async getForumPosts(
    categoryId?: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ posts: ForumPost[]; total: number; hasMore: boolean }> {
    const where: any = { isDeleted: false };
    if (categoryId) where.categoryId = categoryId;

    const [posts, total] = await Promise.all([
      this.db.forumPost.findMany({
        where,
        include: {
          author: {
            select: { id: true, name: true, profileImage: true },
          },
          category: { select: { name: true, slug: true } },
          _count: { select: { comments: true } },
        },
        orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.forumPost.count({ where }),
    ]);

    return {
      posts: posts.map(this.mapForumPost),
      total,
      hasMore: page * limit < total,
    };
  }

  async getPostDetails(postId: string): Promise<ForumPost | null> {
    const post = await this.db.forumPost.findUnique({
      where: { id: postId },
      include: {
        author: {
          select: { id: true, name: true, profileImage: true },
        },
        category: { select: { name: true, slug: true } },
        _count: { select: { comments: true } },
      },
    });

    if (!post) return null;

    // Increment view count
    await this.db.forumPost.update({
      where: { id: postId },
      data: { viewCount: { increment: 1 } },
    });

    return this.mapForumPost({ ...post, viewCount: post.viewCount + 1 });
  }

  async createPost(driverId: string, input: any): Promise<any> {
    // Verify driver exists and can post
    await this.verifyDriverCanPost(driverId);

    const categoryId = input.categoryId;
    const data = input;

    const post = await this.db.forumPost.create({
      data: {
        authorId: driverId,
        categoryId,
        title: data.title,
        content: data.content,
        postType: data.postType || PostType.DISCUSSION,
        images: data.images || [],
        tags: data.tags || [],
        likeCount: 0,
        viewCount: 0,
        isPinned: false,
        isLocked: false,
        isDeleted: false,
      },
      include: {
        author: {
          select: { id: true, name: true, profileImage: true },
        },
        category: { select: { name: true, slug: true } },
      },
    });

    // Track analytics
    this.trackEvent(driverId, DRIVER_EVENTS.POST_CREATED, {
      postId: post.id,
      categoryId,
      postType: data.postType,
    });

    return this.mapForumPost(post);
  }

  async updatePost(
    driverId: string,
    postId: string,
    data: Partial<{ title: string; content: string; tags: string[] }>,
  ): Promise<ForumPost> {
    // Verify ownership
    const existing = await this.db.forumPost.findFirst({
      where: { id: postId, authorId: driverId },
    });

    if (!existing) {
      throw new Error("Post not found or not authorized");
    }

    const post = await this.db.forumPost.update({
      where: { id: postId },
      data: {
        ...data,
        updatedAt: new Date(),
      },
      include: {
        author: {
          select: { id: true, name: true, profileImage: true },
        },
        category: { select: { name: true, slug: true } },
      },
    });

    return this.mapForumPost(post);
  }

  async deletePost(driverId: string, postId: string): Promise<boolean> {
    const existing = await this.db.forumPost.findFirst({
      where: { id: postId, authorId: driverId },
    });

    if (!existing) {
      throw new Error("Post not found or not authorized");
    }

    await this.db.forumPost.update({
      where: { id: postId },
      data: { isDeleted: true },
    });

    return true;
  }

  async likePost(driverId: string, postId: string): Promise<boolean> {
    // Check if already liked
    const existing = await this.db.forumPostLike.findUnique({
      where: {
        driverId_postId: { driverId, postId },
      },
    });

    if (existing) {
      // Unlike
      await this.db.forumPostLike.delete({
        where: { id: existing.id },
      });
      await this.db.forumPost.update({
        where: { id: postId },
        data: { likeCount: { decrement: 1 } },
      });
      return false;
    }

    // Like
    await this.db.forumPostLike.create({
      data: { driverId, postId },
    });
    await this.db.forumPost.update({
      where: { id: postId },
      data: { likeCount: { increment: 1 } },
    });

    // Notify post author
    const post = await this.db.forumPost.findUnique({
      where: { id: postId },
      select: { authorId: true, title: true },
    });

    if (post && post.authorId !== driverId) {
      await this.notificationService?.send({
        userId: post.authorId,
        title: "❤️ Post Liked",
        body: `Someone liked your post "${post.title}"`,
        data: { type: "post_liked", postId },
      });
    }

    return true;
  }

  // -----------------------------------------
  // FORUM - COMMENTS
  // -----------------------------------------

  async getPostComments(
    postId: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<{ comments: ForumComment[]; total: number }> {
    const [comments, total] = await Promise.all([
      this.db.forumComment.findMany({
        where: { postId, isDeleted: false, parentId: null },
        include: {
          author: {
            select: { id: true, name: true, profileImage: true },
          },
          replies: {
            where: { isDeleted: false },
            include: {
              author: {
                select: { id: true, name: true, profileImage: true },
              },
            },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.forumComment.count({ where: { postId, parentId: null } }),
    ]);

    return {
      comments: comments.map(this.mapForumComment),
      total,
    };
  }

  async addComment(
    driverId: string,
    postId: string,
    content: string,
    parentId?: string,
  ): Promise<ForumComment> {
    // Verify post exists and not locked
    const post = await this.db.forumPost.findUnique({
      where: { id: postId },
    });

    if (!post || post.isLocked) {
      throw new Error("Cannot comment on this post");
    }

    const comment = await this.db.forumComment.create({
      data: {
        postId,
        authorId: driverId,
        content,
        parentId,
        likeCount: 0,
        isDeleted: false,
      },
      include: {
        author: {
          select: { id: true, name: true, profileImage: true },
        },
      },
    });

    // Notify post author or parent comment author
    const notifyUserId = parentId
      ? (
          await this.db.forumComment.findUnique({
            where: { id: parentId },
            select: { authorId: true },
          })
        )?.authorId
      : post.authorId;

    if (notifyUserId && notifyUserId !== driverId) {
      await this.notificationService?.send({
        userId: notifyUserId,
        title: "💬 New Comment",
        body: parentId
          ? "Someone replied to your comment"
          : `New comment on your post "${post.title}"`,
        data: { type: "new_comment", postId, commentId: comment.id },
      });
    }

    return this.mapForumComment(comment);
  }

  async deleteComment(driverId: string, commentId: string): Promise<boolean> {
    const existing = await this.db.forumComment.findFirst({
      where: { id: commentId, authorId: driverId },
    });

    if (!existing) {
      throw new Error("Comment not found or not authorized");
    }

    await this.db.forumComment.update({
      where: { id: commentId },
      data: { isDeleted: true },
    });

    return true;
  }

  // -----------------------------------------
  // EVENTS
  // -----------------------------------------

  async getUpcomingEvents(
    city?: string,
    limit: number = 10,
  ): Promise<DriverEvent[]> {
    const where: any = {
      eventDate: { gte: new Date() },
      status: "PUBLISHED",
    };
    if (city) where.city = city;

    const events = await this.db.driverEvent.findMany({
      where,
      include: {
        organizer: {
          select: { id: true, name: true },
        },
        _count: { select: { registrations: true } },
      },
      orderBy: { eventDate: "asc" },
      take: limit,
    });

    return events.map(this.mapDriverEvent);
  }

  async getEventDetails(eventId: string): Promise<DriverEvent | null> {
    const event = await this.db.driverEvent.findUnique({
      where: { id: eventId },
      include: {
        organizer: {
          select: { id: true, name: true },
        },
        _count: { select: { registrations: true } },
      },
    });

    return event ? this.mapDriverEvent(event) : null;
  }

  async createEvent(
    organizerId: string,
    data: Omit<DriverEvent, "id" | "organizerId" | "registrationCount">,
  ): Promise<DriverEvent> {
    const event = await this.db.driverEvent.create({
      data: {
        ...data,
        organizerId,
        status: "PUBLISHED",
      },
      include: {
        organizer: {
          select: { id: true, name: true },
        },
      },
    });

    // Track analytics
    this.trackEvent(organizerId, DRIVER_EVENTS.EVENT_REGISTERED, {
      eventId: event.id,
      eventType: data.eventType,
      city: data.city,
    });

    return this.mapDriverEvent(event);
  }

  async registerForEvent(
    driverId: string,
    eventId: string,
  ): Promise<EventRegistration> {
    // Check if already registered
    const existing = await this.db.eventRegistration.findUnique({
      where: {
        eventId_driverId: { eventId, driverId },
      },
    });

    if (existing) {
      throw new Error("Already registered for this event");
    }

    // Check capacity
    const event = await this.db.driverEvent.findUnique({
      where: { id: eventId },
      include: {
        _count: { select: { registrations: true } },
      },
    });

    if (!event) {
      throw new Error("Event not found");
    }

    const isWaitlisted =
      event.maxAttendees && event._count.registrations >= event.maxAttendees;

    const registration = await this.db.eventRegistration.create({
      data: {
        eventId,
        driverId,
        status: isWaitlisted
          ? RegistrationStatus.WAITLISTED
          : RegistrationStatus.REGISTERED,
        registeredAt: new Date(),
      },
    });

    // Send confirmation
    await this.notificationService?.send({
      userId: driverId,
      title: isWaitlisted ? "📋 Waitlisted" : "✅ Registered",
      body: isWaitlisted
        ? `You're on the waitlist for "${event.title}". We'll notify you if a spot opens up.`
        : `You're registered for "${event.title}" on ${event.eventDate.toDateString()}`,
      data: { type: "event_registration", eventId },
    });

    // Track analytics
    this.trackEvent(driverId, DRIVER_EVENTS.EVENT_REGISTERED, {
      eventId,
      eventTitle: event.title,
      isWaitlisted,
    });

    return {
      id: registration.id,
      eventId: registration.eventId,
      driverId: registration.driverId,
      status: registration.status,
      registeredAt: registration.registeredAt,
      attendedAt: registration.attendedAt,
      feedback: registration.feedback,
      rating: registration.rating,
    };
  }

  async cancelRegistration(
    driverId: string,
    eventId: string,
  ): Promise<boolean> {
    const registration = await this.db.eventRegistration.findUnique({
      where: {
        eventId_driverId: { eventId, driverId },
      },
    });

    if (!registration) {
      throw new Error("Registration not found");
    }

    await this.db.eventRegistration.update({
      where: { id: registration.id },
      data: { status: RegistrationStatus.CANCELLED },
    });

    // Check if someone from waitlist can be promoted
    const waitlisted = await this.db.eventRegistration.findFirst({
      where: {
        eventId,
        status: RegistrationStatus.WAITLISTED,
      },
      orderBy: { registeredAt: "asc" },
    });

    if (waitlisted) {
      await this.db.eventRegistration.update({
        where: { id: waitlisted.id },
        data: { status: RegistrationStatus.REGISTERED },
      });

      const event = await this.db.driverEvent.findUnique({
        where: { id: eventId },
      });

      await this.notificationService?.send({
        userId: waitlisted.driverId,
        title: "🎉 Spot Available!",
        body: `A spot opened up for "${event.title}". You're now registered!`,
        data: { type: "waitlist_promoted", eventId },
      });
    }

    return true;
  }

  async getMyRegistrations(driverId: string): Promise<EventRegistration[]> {
    const registrations = await this.db.eventRegistration.findMany({
      where: { driverId },
      include: { event: true },
      orderBy: { registeredAt: "desc" },
    });

    return registrations.map((r: any) => ({
      id: r.id,
      eventId: r.eventId,
      driverId: r.driverId,
      status: r.status as RegistrationStatus,
      registeredAt: r.registeredAt,
      attendedAt: r.attendedAt,
      feedback: r.feedback,
      rating: r.rating,
      event: this.mapDriverEvent(r.event),
    }));
  }

  // -----------------------------------------
  // MENTORSHIP
  // -----------------------------------------

  async applyForMentorship(driverId: string): Promise<MentorshipPair> {
    // Check eligibility (new drivers only)
    const profile = await this.db.driverProfile.findUnique({
      where: { driverId },
    });

    if (!profile || profile.lifetimeTrips > 50) {
      throw new Error("Mentorship is for new drivers with fewer than 50 trips");
    }

    // Check if already in mentorship
    const existing = await this.db.mentorshipPair.findFirst({
      where: {
        menteeId: driverId,
        status: { in: [MentorshipStatus.PENDING, MentorshipStatus.ACTIVE] },
      },
    });

    if (existing) {
      throw new Error("Already in a mentorship program");
    }

    // Create pending mentorship
    const mentorship = await this.db.mentorshipPair.create({
      data: {
        menteeId: driverId,
        status: MentorshipStatus.PENDING,
      },
    });

    // Try to auto-match with available mentor
    await this.tryAutoMatchMentor(mentorship.id);

    return this.mapMentorship(mentorship);
  }

  async becomeMentor(driverId: string): Promise<boolean> {
    // Check eligibility (experienced drivers only)
    const profile = await this.db.driverProfile.findUnique({
      where: { driverId },
    });

    if (!profile || profile.lifetimeTrips < 1000) {
      throw new Error("Mentors must have completed at least 1,000 trips");
    }

    if (Number.parseFloat(profile.averageRating) < 4.8) {
      throw new Error("Mentors must have a rating of 4.8 or higher");
    }

    // Check mentorship certification
    const cert = await this.db.driverCertification.findFirst({
      where: { driverId, code: "mentorship" },
    });

    if (!cert) {
      throw new Error("Please complete the Mentorship Training module first");
    }

    // Update profile to enable mentorship
    await this.db.driverProfile.update({
      where: { driverId },
      data: { isMentor: true, maxMentees: 3 },
    });

    return true;
  }

  async getMentorshipStatus(driverId: string): Promise<MentorshipPair | null> {
    // Check if mentee
    let mentorship = await this.db.mentorshipPair.findFirst({
      where: {
        menteeId: driverId,
        status: { in: [MentorshipStatus.PENDING, MentorshipStatus.ACTIVE] },
      },
      include: {
        mentor: {
          select: { id: true, name: true, profileImage: true, phone: true },
        },
      },
    });

    if (mentorship) {
      return this.mapMentorship(mentorship);
    }

    // Check if mentor
    const mentorships = await this.db.mentorshipPair.findMany({
      where: {
        mentorId: driverId,
        status: MentorshipStatus.ACTIVE,
      },
      include: {
        mentee: {
          select: { id: true, name: true, profileImage: true, phone: true },
        },
      },
    });

    if (mentorships.length > 0) {
      return this.mapMentorship(mentorships[0]);
    }

    return null;
  }

  async completeMentorTask(
    mentorshipId: string,
    taskCode: string,
    notes?: string,
  ): Promise<boolean> {
    const mentorship = await this.db.mentorshipPair.findUnique({
      where: { id: mentorshipId },
    });

    if (!mentorship) {
      throw new Error("Mentorship not found");
    }

    // Update completed tasks
    const tasks = mentorship.completedTasks || [];
    if (!tasks.includes(taskCode)) {
      tasks.push(taskCode);
    }

    await this.db.mentorshipPair.update({
      where: { id: mentorshipId },
      data: {
        completedTasks: tasks,
        notes: notes
          ? [
              ...(mentorship.notes || []),
              { taskCode, note: notes, date: new Date() },
            ]
          : mentorship.notes,
      },
    });

    // Check if all tasks complete
    const REQUIRED_TASKS = [
      "introduction",
      "app_walkthrough",
      "first_ride",
      "safety_review",
      "earnings_review",
      "q_and_a",
    ];

    if (REQUIRED_TASKS.every((t) => tasks.includes(t))) {
      await this.completeMentorship(mentorshipId);
    }

    return true;
  }

  private async completeMentorship(mentorshipId: string): Promise<void> {
    const mentorship = await this.db.mentorshipPair.update({
      where: { id: mentorshipId },
      data: {
        status: MentorshipStatus.COMPLETED,
        completedAt: new Date(),
      },
      include: {
        mentor: { select: { id: true, name: true } },
        mentee: { select: { id: true, name: true } },
      },
    });

    // Award badges
    await this.awardMentorshipBadges(mentorship);

    // Notify both parties
    await this.notificationService?.send({
      userId: mentorship.menteeId,
      title: "🎓 Mentorship Complete!",
      body: `Congratulations! You've completed the mentorship program with ${mentorship.mentor.name}.`,
      data: { type: "mentorship_complete", mentorshipId },
    });

    await this.notificationService?.send({
      userId: mentorship.mentorId,
      title: "🎉 Mentee Graduated!",
      body: `${mentorship.mentee.name} has completed their mentorship. Thank you for your guidance!`,
      data: { type: "mentee_graduated", mentorshipId },
    });
  }

  private async tryAutoMatchMentor(mentorshipId: string): Promise<void> {
    // Find available mentor
    const mentorship = await this.db.mentorshipPair.findUnique({
      where: { id: mentorshipId },
      include: { mentee: { select: { city: true } } },
    });

    const availableMentor = await this.db.driverProfile.findFirst({
      where: {
        isMentor: true,
        activeMentees: { lt: this.db.driverProfile.fields.maxMentees },
        driver: { city: mentorship.mentee.city },
      },
      orderBy: { averageRating: "desc" },
    });

    if (availableMentor) {
      await this.db.mentorshipPair.update({
        where: { id: mentorshipId },
        data: {
          mentorId: availableMentor.driverId,
          status: MentorshipStatus.ACTIVE,
          startedAt: new Date(),
        },
      });

      await this.db.driverProfile.update({
        where: { driverId: availableMentor.driverId },
        data: { activeMentees: { increment: 1 } },
      });

      // Notify both
      await this.notificationService?.send({
        userId: mentorship.menteeId,
        title: "🤝 Mentor Matched!",
        body: "You've been matched with a mentor. Check your mentorship status for details!",
        data: { type: "mentor_matched", mentorshipId },
      });
    }
  }

  private async awardMentorshipBadges(mentorship: any): Promise<void> {
    // Award mentee badge
    await this.db.driverBadge.upsert({
      where: {
        driverId_code: {
          driverId: mentorship.menteeId,
          code: "mentee_graduate",
        },
      },
      update: {},
      create: {
        driverId: mentorship.menteeId,
        code: "mentee_graduate",
        name: "Mentee Graduate",
        description: "Completed the mentorship program",
        category: "community",
        iconUrl: "/badges/mentee_graduate.png",
        rarity: "UNCOMMON",
        points: 50,
        earnedAt: new Date(),
      },
    });

    // Check if mentor qualifies for badge
    const mentorCompletions = await this.db.mentorshipPair.count({
      where: {
        mentorId: mentorship.mentorId,
        status: MentorshipStatus.COMPLETED,
      },
    });

    if (mentorCompletions >= 10) {
      await this.db.driverBadge.upsert({
        where: {
          driverId_code: { driverId: mentorship.mentorId, code: "mentor" },
        },
        update: {},
        create: {
          driverId: mentorship.mentorId,
          code: "mentor",
          name: "Mentor",
          description: "Successfully mentored 10 new drivers",
          category: "community",
          iconUrl: "/badges/mentor.png",
          rarity: "EPIC",
          points: 250,
          earnedAt: new Date(),
        },
      });
    }
  }

  // -----------------------------------------
  // LEADERBOARDS
  // -----------------------------------------

  async getLeaderboard(
    type: string,
    period: LeaderboardPeriod,
    city?: string,
    limit: number = 100,
  ): Promise<DriverLeaderboard> {
    const cacheKey = `leaderboard:${type}:${period}:${city || "all"}`;
    const cached = await this.getCached<DriverLeaderboard>(cacheKey);
    if (cached) return cached;

    const dateFilter = this.getDateFilter(period);

    let entries: LeaderboardEntry[];

    switch (type) {
      case "trips":
        entries = await this.getTripsLeaderboard(dateFilter, city, limit);
        break;
      case "earnings":
        entries = await this.getEarningsLeaderboard(dateFilter, city, limit);
        break;
      case "rating":
        entries = await this.getRatingLeaderboard(city, limit);
        break;
      case "points":
        entries = await this.getPointsLeaderboard(city, limit);
        break;
      default:
        entries = await this.getTripsLeaderboard(dateFilter, city, limit);
    }

    const leaderboard: DriverLeaderboard = {
      type,
      period,
      city,
      entries,
      lastUpdated: new Date(),
    };

    // Cache for 5 minutes
    await this.setCache(cacheKey, leaderboard, 300);

    return leaderboard;
  }

  async getDriverRanking(
    driverId: string,
    type: string,
    period: LeaderboardPeriod,
  ): Promise<{
    rank: number;
    value: number;
    percentile: number;
  }> {
    const dateFilter = this.getDateFilter(period);

    // Get driver's value
    let driverValue = 0;
    let totalDrivers = 0;
    let driversAbove = 0;

    switch (type) {
      case "trips": {
        const tripStats = await this.db.tripEarning.groupBy({
          by: ["driverId"],
          where: { completedAt: { gte: dateFilter } },
          _count: true,
        });

        totalDrivers = tripStats.length;
        const driverTrips = tripStats.find((s: any) => s.driverId === driverId);
        driverValue = driverTrips?._count || 0;
        driversAbove = tripStats.filter(
          (s: any) => s._count > driverValue,
        ).length;
        break;
      }

      case "earnings": {
        const earningsStats = await this.db.tripEarning.groupBy({
          by: ["driverId"],
          where: { completedAt: { gte: dateFilter } },
          _sum: { totalEarning: true },
        });

        totalDrivers = earningsStats.length;
        const driverEarnings = earningsStats.find(
          (s: any) => s.driverId === driverId,
        );
        driverValue = Number.parseFloat(
          driverEarnings?._sum.totalEarning || "0",
        );
        driversAbove = earningsStats.filter(
          (s: any) => Number.parseFloat(s._sum.totalEarning) > driverValue,
        ).length;
        break;
      }

      default:
        return { rank: 0, value: 0, percentile: 0 };
    }

    const rank = driversAbove + 1;
    const percentile =
      totalDrivers > 0
        ? Math.round(((totalDrivers - rank + 1) / totalDrivers) * 100)
        : 0;

    return { rank, value: driverValue, percentile };
  }

  // -----------------------------------------
  // DRIVER OF THE MONTH
  // -----------------------------------------

  async nominateDriverOfMonth(
    nominatorId: string,
    nomineeId: string,
    reason: string,
  ): Promise<boolean> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Check if already nominated this month
    const existing = await this.db.driverOfMonthNomination.findFirst({
      where: {
        nominatorId,
        month: monthStart,
      },
    });

    if (existing) {
      throw new Error("You can only nominate once per month");
    }

    // Can't nominate yourself
    if (nominatorId === nomineeId) {
      throw new Error("You can't nominate yourself");
    }

    await this.db.driverOfMonthNomination.create({
      data: {
        nominatorId,
        nomineeId,
        reason,
        month: monthStart,
      },
    });

    return true;
  }

  async getDriverOfMonth(city?: string): Promise<any> {
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const monthStart = new Date(
      lastMonth.getFullYear(),
      lastMonth.getMonth(),
      1,
    );

    const winner = await this.db.driverOfMonth.findFirst({
      where: { month: monthStart, ...(city && { city }) },
      include: {
        winner: {
          select: { id: true, name: true, profileImage: true },
        },
      },
    });

    if (!winner) {
      return { winner: null, month: monthStart, nominations: 0 };
    }

    return {
      winner: {
        id: winner.winner.id,
        name: winner.winner.name,
        profileImage: winner.winner.profileImage,
      },
      month: winner.month,
      nominations: winner.nominationCount,
      story: winner.story,
    };
  }

  // -----------------------------------------
  // PRIVATE HELPERS
  // -----------------------------------------

  private async getTripsLeaderboard(
    dateFilter: Date,
    city: string | undefined,
    limit: number,
  ): Promise<LeaderboardEntry[]> {
    const stats = await this.db.tripEarning.groupBy({
      by: ["driverId"],
      where: {
        completedAt: { gte: dateFilter },
        ...(city && { driver: { city } }),
      },
      _count: true,
      orderBy: { _count: { driverId: "desc" } },
      take: limit,
    });

    const driverIds = stats.map((s: any) => s.driverId);
    const drivers = await this.db.driver.findMany({
      where: { id: { in: driverIds } },
      select: { id: true, name: true, profileImage: true },
    });
    const driverMap = new Map(drivers.map((d: any) => [d.id, d]));

    return stats.map((s: any, index: number) => {
      const driver = driverMap.get(s.driverId) || {};
      return {
        rank: index + 1,
        driverId: s.driverId,
        driverName: (driver as any)?.name || "Unknown",
        driverAvatar: (driver as any)?.profileImage,
        value: s._count,
        change: 0, // Would calculate from previous period
      };
    });
  }

  private async getEarningsLeaderboard(
    dateFilter: Date,
    city: string | undefined,
    limit: number,
  ): Promise<LeaderboardEntry[]> {
    const stats = await this.db.tripEarning.groupBy({
      by: ["driverId"],
      where: {
        completedAt: { gte: dateFilter },
        ...(city && { driver: { city } }),
      },
      _sum: { totalEarning: true },
      orderBy: { _sum: { totalEarning: "desc" } },
      take: limit,
    });

    const driverIds = stats.map((s: any) => s.driverId);
    const drivers = await this.db.driver.findMany({
      where: { id: { in: driverIds } },
      select: { id: true, name: true, profileImage: true },
    });
    const driverMap = new Map(drivers.map((d: any) => [d.id, d]));

    return stats.map((s: any, index: number) => {
      const driver = driverMap.get(s.driverId) || {};
      return {
        rank: index + 1,
        driverId: s.driverId,
        driverName: (driver as any)?.name || "Unknown",
        driverAvatar: (driver as any)?.profileImage,
        value: Number.parseFloat(s._sum.totalEarning || "0"),
        change: 0,
      };
    });
  }

  private async getRatingLeaderboard(
    city: string | undefined,
    limit: number,
  ): Promise<LeaderboardEntry[]> {
    const profiles = await this.db.driverProfile.findMany({
      where: {
        totalRatings: { gte: 50 }, // Minimum ratings for eligibility
        ...(city && { driver: { city } }),
      },
      include: {
        driver: {
          select: { id: true, name: true, profileImage: true },
        },
      },
      orderBy: { averageRating: "desc" },
      take: limit,
    });

    return profiles.map((p: any, index: number) => ({
      rank: index + 1,
      driverId: p.driverId,
      driverName: p.driver?.name || "Unknown",
      driverAvatar: p.driver?.profileImage,
      value: Number.parseFloat(p.averageRating),
      change: 0,
    }));
  }

  private async getPointsLeaderboard(
    city: string | undefined,
    limit: number,
  ): Promise<LeaderboardEntry[]> {
    const profiles = await this.db.driverProfile.findMany({
      where: city ? { driver: { city } } : {},
      include: {
        driver: {
          select: { id: true, name: true, profileImage: true },
        },
      },
      orderBy: { totalPoints: "desc" },
      take: limit,
    });

    return profiles.map((p: any, index: number) => ({
      rank: index + 1,
      driverId: p.driverId,
      driverName: p.driver?.name || "Unknown",
      driverAvatar: p.driver?.profileImage,
      value: p.totalPoints,
      change: 0,
    }));
  }

  private getDateFilter(period: LeaderboardPeriod): Date {
    const now = new Date();
    switch (period) {
      case LeaderboardPeriod.DAILY:
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
      case LeaderboardPeriod.WEEKLY: {
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay());
        weekStart.setHours(0, 0, 0, 0);
        return weekStart;
      }
      case LeaderboardPeriod.MONTHLY:
        return new Date(now.getFullYear(), now.getMonth(), 1);
      case LeaderboardPeriod.ALL_TIME:
        return new Date(0);
      default:
        return new Date(now.getFullYear(), now.getMonth(), 1);
    }
  }

  private async verifyDriverCanPost(driverId: string): Promise<any> {
    const driver = await this.db.driver.findUnique({
      where: { id: driverId },
    });

    if (!driver) {
      throw new Error("Driver not found");
    }

    // Check for posting restrictions (e.g., banned from forum)
    // Add your moderation logic here

    return driver;
  }

  // Mappers
  private mapForumPost(p: any): ForumPost {
    return {
      id: p.id,
      categoryId: p.categoryId,
      category: p.category,
      authorId: p.authorId,
      author: p.author,
      title: p.title,
      content: p.content,
      contentHtml: p.content,
      tags: p.tags,
      isPinned: p.isPinned,
      isLocked: p.isLocked,
      viewCount: p.viewCount,
      likeCount: p.likeCount,
      commentCount: p._count?.comments || 0,
      status: p.status || "PUBLISHED",
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    } as ForumPost;
  }

  private mapForumComment(c: any): ForumComment {
    return {
      id: c.id,
      postId: c.postId,
      parentId: c.parentId,
      authorId: c.authorId,
      author: c.author,
      content: c.content,
      contentHtml: c.content,
      likeCount: c.likeCount,
      status: c.status || "PUBLISHED",
      createdAt: c.createdAt,
      replies: c.replies?.map((r: any) => this.mapForumComment(r)),
    } as ForumComment;
  }

  private mapDriverEvent(e: any): DriverEvent {
    return {
      id: e.id,
      name: e.title || e.name,
      description: e.description,
      eventType: e.eventType as EventType,
      city: e.city,
      venue: e.venue,
      address: e.address,
      latitude: e.latitude ? Number.parseFloat(e.latitude) : undefined,
      longitude: e.longitude ? Number.parseFloat(e.longitude) : undefined,
      isVirtual: e.isVirtual,
      virtualUrl: e.virtualLink,
      startTime: e.eventDate,
      endTime: e.endDate,
      maxAttendees: e.maxAttendees,
      currentAttendees: e._count?.registrations || 0,
      imageUrl: e.imageUrl,
      isActive: e.status === "PUBLISHED",
    } as DriverEvent;
  }

  private mapMentorship(m: any): MentorshipPair {
    return {
      id: m.id,
      mentorId: m.mentorId,
      mentor: m.mentor,
      menteeId: m.menteeId,
      mentee: m.mentee,
      status: m.status as MentorshipStatus,
      startedAt: m.startedAt,
      endedAt: m.completedAt,
      sessionsCompleted: (m.completedTasks || []).length,
      targetSessions: 6,
      goals: m.notes || [],
      notes: m.notes ? JSON.stringify(m.notes) : undefined,
    } as MentorshipPair;
  }

  private async getCached<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.redis?.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  }

  private async setCache(
    key: string,
    data: unknown,
    ttl: number,
  ): Promise<void> {
    try {
      await this.redis?.setex(key, ttl, JSON.stringify(data));
    } catch {
      // Ignore cache errors
    }
  }

  private trackEvent(
    driverId: string,
    eventName: string,
    properties: Record<string, unknown>,
  ): void {
    this.analyticsService?.track({
      userId: driverId,
      event: eventName,
      properties: {
        ...properties,
        timestamp: new Date().toISOString(),
      },
    });
  }
}
