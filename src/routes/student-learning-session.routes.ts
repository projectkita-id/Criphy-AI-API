import { Router } from "express";
import { Prisma } from "../generated/prisma/client";

import { prisma } from "../lib/prisma";
import { requireAuth } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";

import {
  learningPhaseParamsSchema,
  savePhaseResponseSchema,
} from "../validators/student-learning-session.validator";

import {
  structuredPhaseSubmissionSchema,
  validateLearningPhaseSubmission,
} from "../validators/learning-phase-submission.validator";

const router = Router();

// ==========================================
// POST /api/student/learning-sessions
// Start or resume learning session
// ==========================================

router.post(
  "/learning-sessions",
  requireAuth,
  requireRole("STUDENT"),
  async (_req, res) => {
    const studentId: string | undefined =
      res.locals.user?.id;

    if (!studentId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    try {
      const result = await prisma.$transaction(
        async (tx) => {
          // 1. Lock active module assignment
          const lockedAssignments = await tx.$queryRaw<
            { id: string }[]
          >`
            SELECT id
            FROM "StudentModuleAssignment"
            WHERE "studentId" = ${studentId}::uuid
              AND "status" = 'ACTIVE'
            FOR UPDATE
          `;

          if (lockedAssignments.length === 0) {
            throw new Error("NO_ACTIVE_ASSIGNMENT");
          }

          // 2. Retrieve active assignment
          const assignment =
            await tx.studentModuleAssignment.findFirst({
              where: {
                studentId,
                status: "ACTIVE",
              },
              select: {
                id: true,
                moduleId: true,
                stage: true,
              },
            });

          if (!assignment) {
            throw new Error("NO_ACTIVE_ASSIGNMENT");
          }

          // 3. Validate learning stage
          if (assignment.stage !== "LEARNING") {
            throw new Error("INVALID_STAGE");
          }

          // 4. Verify pre-test submission
          const preTestAttempt =
            await tx.assessmentAttempt.findFirst({
              where: {
                studentId,
                assessment: {
                  is: {
                    moduleId: assignment.moduleId,
                    type: "PRE_TEST",
                  },
                },
                status: {
                  in: ["PENDING_GRADING", "GRADED"],
                },
                submittedAt: {
                  not: null,
                },
              },
              select: {
                id: true,
              },
            });

          if (!preTestAttempt) {
            throw new Error("PRE_TEST_NOT_SUBMITTED");
          }

          // 5. Resume existing session
          const existingSession =
            await tx.learningSession.findUnique({
              where: {
                assignmentId: assignment.id,
              },
              include: {
                phases: {
                  orderBy: {
                    phaseNumber: "asc",
                  },
                  select: {
                    id: true,
                    phaseNumber: true,
                    status: true,
                    startedAt: true,
                    completedAt: true,
                  },
                },
              },
            });

          if (existingSession) {
            return {
              created: false,
              session: existingSession,
            };
          }

          // 6. Create session + five phases
          const now = new Date();

          const session = await tx.learningSession.create({
            data: {
              assignmentId: assignment.id,
              status: "IN_PROGRESS",
              currentPhase: 1,
              phases: {
                create: [
                  {
                    phaseNumber: 1,
                    status: "ACTIVE",
                    startedAt: now,
                  },
                  {
                    phaseNumber: 2,
                    status: "LOCKED",
                  },
                  {
                    phaseNumber: 3,
                    status: "LOCKED",
                  },
                  {
                    phaseNumber: 4,
                    status: "LOCKED",
                  },
                  {
                    phaseNumber: 5,
                    status: "LOCKED",
                  },
                ],
              },
            },
            include: {
              phases: {
                orderBy: {
                  phaseNumber: "asc",
                },
                select: {
                  id: true,
                  phaseNumber: true,
                  status: true,
                  startedAt: true,
                  completedAt: true,
                },
              },
            },
          });

          return {
            created: true,
            session,
          };
        },
        {
          maxWait: 5000,
          timeout: 10000,
        }
      );

      res.status(result.created ? 201 : 200).json({
        success: true,
        message: result.created
          ? "Learning session started successfully"
          : "Learning session resumed successfully",
        data: result.session,
      });
    } catch (error) {
      const knownErrors: Record<
        string,
        { status: number; message: string }
      > = {
        NO_ACTIVE_ASSIGNMENT: {
          status: 403,
          message:
            "You do not have an active module assignment",
        },
        INVALID_STAGE: {
          status: 409,
          message:
            "Your module assignment is not at the learning stage",
        },
        PRE_TEST_NOT_SUBMITTED: {
          status: 409,
          message:
            "You must submit your pre-test before starting the learning session",
        },
      };

      if (error instanceof Error) {
        const known = knownErrors[error.message];

        if (known) {
          res.status(known.status).json({
            success: false,
            message: known.message,
          });
          return;
        }
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        res.status(409).json({
          success: false,
          message:
            "A learning session already exists for this assignment. Please retry.",
        });
        return;
      }

      console.error(
        "Failed to start learning session:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Failed to start learning session",
      });
    }
  }
);

// ==========================================
// GET /api/student/learning-sessions/active
// Retrieve active learning session
// ==========================================

router.get(
  "/learning-sessions/active",
  requireAuth,
  requireRole("STUDENT"),
  async (_req, res) => {
    const studentId: string | undefined =
      res.locals.user?.id;

    if (!studentId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    try {
      // 1. Find student's active assignment
      const assignment =
        await prisma.studentModuleAssignment.findFirst({
          where: {
            studentId,
            status: "ACTIVE",
          },
          select: {
            id: true,
            context: true,
            stage: true,
            module: {
              select: {
                id: true,
                title: true,
                description: true,
                topic: true,
                gradeLevel: true,
                learningObjectives: true,
                case: {
                  select: {
                    id: true,
                    title: true,
                    context: true,
                    topic: true,
                    stimulus: true,
                    scientificData: true,
                  },
                },
              },
            },
            learningSession: {
              select: {
                id: true,
                status: true,
                currentPhase: true,
                startedAt: true,
                completedAt: true,
                phases: {
                  orderBy: {
                    phaseNumber: "asc",
                  },
                  select: {
                    id: true,
                    phaseNumber: true,
                    status: true,
                    startedAt: true,
                    completedAt: true,
                  },
                },
              },
            },
          },
        });

      // 2. Validate active assignment
      if (!assignment) {
        res.status(404).json({
          success: false,
          message: "No active module assignment found",
        });
        return;
      }

      // 3. Validate learning stage
      if (assignment.stage !== "LEARNING") {
        res.status(409).json({
          success: false,
          message:
            "Your module assignment is not at the learning stage",
        });
        return;
      }

      // 4. Validate learning session exists
      const session = assignment.learningSession;

      if (!session) {
        res.status(404).json({
          success: false,
          message:
            "Learning session has not been started",
        });
        return;
      }

      // 5. Validate session lifecycle
      if (session.status !== "IN_PROGRESS") {
        res.status(409).json({
          success: false,
          message:
            "Learning session is no longer in progress",
        });
        return;
      }

      // 6. Identify current phase
      const currentPhase = session.phases.find(
        (phase) =>
          phase.phaseNumber === session.currentPhase
      );

      if (
        !currentPhase ||
        currentPhase.status !== "ACTIVE"
      ) {
        res.status(409).json({
          success: false,
          message:
            "Learning session has an invalid current phase",
        });
        return;
      }

      // 7. Return student-safe learning data
      res.status(200).json({
        success: true,
        message: "Active learning session retrieved",
        data: {
          assignment: {
            id: assignment.id,
            context: assignment.context,
            stage: assignment.stage,
          },
          module: assignment.module,
          session: {
            id: session.id,
            status: session.status,
            currentPhase: session.currentPhase,
            startedAt: session.startedAt,
            currentPhaseProgress: currentPhase,
            phases: session.phases,
          },
        },
      });
    } catch (error) {
      console.error(
        "Failed to retrieve active learning session:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Failed to retrieve active learning session",
      });
    }
  }
);


// ==========================================
// POST /api/student/learning-sessions/:sessionId/phases/:phase/responses
// Save student response or structured submission
// ==========================================

router.post(
  "/learning-sessions/:sessionId/phases/:phase/responses",
  requireAuth,
  requireRole("STUDENT"),
  async (req, res) => {
    const studentId: string | undefined =
      res.locals.user?.id;

    if (!studentId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    // 1. Validate URL parameters
    const parsedParams =
      learningPhaseParamsSchema.safeParse(req.params);

    if (!parsedParams.success) {
      res.status(400).json({
        success: false,
        message: "Invalid learning phase parameters",
        errors: parsedParams.error.flatten(),
      });
      return;
    }

    const {
      sessionId,
      phase: phaseNumber,
    } = parsedParams.data;

    // 2. Determine request type
    const isSubmission =
      req.body?.type === "SUBMISSION";

    let responseData:
      | { answer: string; question?: string }
      | undefined;

    let submissionContent:
      | Record<string, unknown>
      | undefined;

    if (isSubmission) {
      // ==========================================
      // STRUCTURED SUBMISSION VALIDATION
      // ==========================================

      // Structured submissions are supported
      // for phases 1, 4, and 5.
      if (
        phaseNumber !== 1 &&
        phaseNumber !== 4 &&
        phaseNumber !== 5
      ) {
        res.status(400).json({
          success: false,
          message:
            "Structured submissions are currently supported only for phases 1, 4 and 5",
        });
        return;
      }

      const parsedEnvelope =
        structuredPhaseSubmissionSchema.safeParse(
          req.body
        );

      if (!parsedEnvelope.success) {
        res.status(400).json({
          success: false,
          message: "Invalid submission request",
          errors: parsedEnvelope.error.flatten(),
        });
        return;
      }

      const parsedContent =
        validateLearningPhaseSubmission(
          phaseNumber,
          parsedEnvelope.data.content
        );

      if (!parsedContent.success) {
        res.status(400).json({
          success: false,
          message: "Invalid structured submission",
          errors: parsedContent.error,
        });
        return;
      }

      submissionContent = parsedContent.data;
    } else {
      // ==========================================
      // ORDINARY RESPONSE VALIDATION
      // ==========================================

      // Existing { answer, question? } requests
      // remain supported for all five phases.
      const parsedBody =
        savePhaseResponseSchema.safeParse(req.body);

      if (!parsedBody.success) {
        res.status(400).json({
          success: false,
          message: "Invalid response data",
          errors: parsedBody.error.flatten(),
        });
        return;
      }

      responseData = parsedBody.data;
    }

    try {
      const result = await prisma.$transaction(
        async (tx) => {
          // 3. Lock learning session owned by student
          const lockedSessions = await tx.$queryRaw<
            { id: string }[]
          >`
            SELECT ls.id
            FROM "LearningSession" ls
            JOIN "StudentModuleAssignment" a
              ON a.id = ls."assignmentId"
            WHERE ls.id = ${sessionId}::uuid
              AND a."studentId" = ${studentId}::uuid
            FOR UPDATE OF ls
          `;

          if (lockedSessions.length === 0) {
            return {
              error: "SESSION_NOT_FOUND" as const,
            };
          }

          // 4. Retrieve session and phase
          const session =
            await tx.learningSession.findUnique({
              where: {
                id: sessionId,
              },
              select: {
                status: true,
                currentPhase: true,
                assignment: {
                  select: {
                    status: true,
                    stage: true,
                  },
                },
                phases: {
                  where: {
                    phaseNumber,
                  },
                  select: {
                    id: true,
                    status: true,
                    submission: {
                      select: {
                        id: true,
                      },
                    },
                  },
                },
              },
            });

          if (!session) {
            return {
              error: "SESSION_NOT_FOUND" as const,
            };
          }

          // 5. Validate session lifecycle
          if (
            session.assignment.status !== "ACTIVE" ||
            session.assignment.stage !== "LEARNING" ||
            session.status !== "IN_PROGRESS"
          ) {
            return {
              error: "SESSION_NOT_ACTIVE" as const,
            };
          }

          // 6. Validate current phase
          if (session.currentPhase !== phaseNumber) {
            return {
              error: "WRONG_PHASE" as const,
            };
          }

          const phase = session.phases[0];

          if (!phase || phase.status !== "ACTIVE") {
            return {
              error: "PHASE_NOT_ACTIVE" as const,
            };
          }

          // ==========================================
          // STRUCTURED SUBMISSION
          // ==========================================

          if (isSubmission) {
            if (!submissionContent) {
              throw new Error(
                "Validated submission content missing"
              );
            }

            // Allow only one structured submission
            // per learning phase.
            if (phase.submission) {
              return {
                error: "ALREADY_SUBMITTED" as const,
              };
            }

            const submission =
              await tx.learningPhaseSubmission.create({
                data: {
                  phaseProgressId: phase.id,
                  content:
                    submissionContent as Prisma.InputJsonObject,
                },
                select: {
                  id: true,
                  phaseProgressId: true,
                  content: true,
                  submittedAt: true,
                  createdAt: true,
                },
              });

            return {
              kind: "SUBMISSION" as const,
              phaseNumber,
              submission,
            };
          }

          // ==========================================
          // ORDINARY RESPONSE
          // ==========================================

          if (!responseData) {
            throw new Error(
              "Validated response data missing"
            );
          }

          const response =
            await tx.learningPhaseResponse.create({
              data: {
                phaseProgressId: phase.id,
                answer: responseData.answer,
                question:
                  responseData.question ?? null,
              },
              select: {
                id: true,
                answer: true,
                question: true,
                createdAt: true,
              },
            });

          return {
            kind: "RESPONSE" as const,
            phaseNumber,
            response,
          };
        },
        {
          maxWait: 5000,
          timeout: 10000,
        }
      );

      // 7. Handle expected errors
      if (result.error !== undefined) {
        const errors = {
          SESSION_NOT_FOUND: {
            status: 404,
            message: "Learning session not found",
          },
          SESSION_NOT_ACTIVE: {
            status: 409,
            message: "Learning session is not active",
          },
          WRONG_PHASE: {
            status: 409,
            message:
              "You can only answer the current phase",
          },
          PHASE_NOT_ACTIVE: {
            status: 409,
            message:
              "This learning phase is not active",
          },
          ALREADY_SUBMITTED: {
            status: 409,
            message:
              "This phase already has a structured submission",
          },
        };

        const error = errors[result.error];

        res.status(error.status).json({
          success: false,
          message: error.message,
        });
        return;
      }

      // 8. Return saved data
      if (result.kind === "SUBMISSION") {
        res.status(201).json({
          success: true,
          message:
            "Structured learning phase submission saved successfully",
          data: {
            type: "SUBMISSION",
            phaseNumber: result.phaseNumber,
            submission: result.submission,
          },
        });
        return;
      }

      res.status(201).json({
        success: true,
        message:
          "Learning phase response saved successfully",
        data: {
          phaseNumber: result.phaseNumber,
          response: result.response,
        },
      });
    } catch (error) {
      // Handle unique submission conflicts
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        res.status(409).json({
          success: false,
          message:
            "This phase already has a structured submission",
        });
        return;
      }

      console.error(
        "Failed to save learning phase data:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Failed to save learning phase data",
      });
    }
  }
);

  // ==========================================
  // POST /api/student/learning-sessions/:sessionId/phases/:phase/complete
  // Complete current phase or unlock post-test
  // ==========================================

  router.post(
    "/learning-sessions/:sessionId/phases/:phase/complete",
    requireAuth,
    requireRole("STUDENT"),
    async (req, res) => {
      const studentId: string | undefined =
        res.locals.user?.id;

      if (!studentId) {
        res.status(401).json({
          success: false,
          message: "Authentication required",
        });
        return;
      }

      // 1. Validate URL parameters
      const parsedParams =
        learningPhaseParamsSchema.safeParse(req.params);

      if (!parsedParams.success) {
        res.status(400).json({
          success: false,
          message: "Invalid learning phase parameters",
          errors: parsedParams.error.flatten(),
        });
        return;
      }

      const {
        sessionId,
        phase: phaseNumber,
      } = parsedParams.data;

      try {
        const result = await prisma.$transaction(
          async (tx) => {
            // 2. Lock learning session owned by student
            const lockedSessions = await tx.$queryRaw<
              { id: string }[]
            >`
              SELECT ls.id
              FROM "LearningSession" ls
              JOIN "StudentModuleAssignment" a
                ON a.id = ls."assignmentId"
              WHERE ls.id = ${sessionId}::uuid
                AND a."studentId" = ${studentId}::uuid
              FOR UPDATE OF ls
            `;

            if (lockedSessions.length === 0) {
              return {
                error: "SESSION_NOT_FOUND" as const,
              };
            }

            // 3. Retrieve session and phase records
            const session =
              await tx.learningSession.findUnique({
                where: {
                  id: sessionId,
                },
                select: {
                  id: true,
                  status: true,
                  currentPhase: true,
                  assignment: {
                    select: {
                      id: true,
                      moduleId: true,
                      status: true,
                      stage: true,
                    },
                  },
                  phases: {
                    where: {
                      phaseNumber: {
                        in: [
                          phaseNumber,
                          phaseNumber + 1,
                        ],
                      },
                    },
                    select: {
                      id: true,
                      phaseNumber: true,
                      status: true,
                    },
                  },
                },
              });

            if (!session) {
              return {
                error: "SESSION_NOT_FOUND" as const,
              };
            }

            // 4. Validate session lifecycle
            if (
              session.status !== "IN_PROGRESS" ||
              session.assignment.status !== "ACTIVE" ||
              session.assignment.stage !== "LEARNING"
            ) {
              return {
                error: "SESSION_NOT_ACTIVE" as const,
              };
            }

            if (session.currentPhase !== phaseNumber) {
              return {
                error: "WRONG_PHASE" as const,
              };
            }

            const currentPhase = session.phases.find(
              (phase) =>
                phase.phaseNumber === phaseNumber
            );

            const nextPhase = session.phases.find(
              (phase) =>
                phase.phaseNumber === phaseNumber + 1
            );

            if (
              !currentPhase ||
              currentPhase.status !== "ACTIVE"
            ) {
              return {
                error: "PHASE_NOT_ACTIVE" as const,
              };
            }

            // Phases 1-4 must have a locked next phase
            if (phaseNumber < 5) {
              if (
                !nextPhase ||
                nextPhase.status !== "LOCKED"
              ) {
                return {
                  error:
                    "NEXT_PHASE_NOT_LOCKED" as const,
                };
              }
            }

            // ==========================================
            // 5. VALIDATE PHASE COMPLETION REQUIREMENTS
            // ==========================================

            if (
              phaseNumber === 1 ||
              phaseNumber === 4 ||
              phaseNumber === 5
            ) {
              // Phases 1, 4 and 5 require
              // a structured submission.
              const submission =
                await tx.learningPhaseSubmission.findUnique({
                  where: {
                    phaseProgressId: currentPhase.id,
                  },
                  select: {
                    id: true,
                  },
                });

              if (!submission) {
                return {
                  error: "NO_SUBMISSION" as const,
                };
              }
            } else {
              // Phases 2 and 3 require
              // at least one ordinary response.
              const responseCount =
                await tx.learningPhaseResponse.count({
                  where: {
                    phaseProgressId: currentPhase.id,
                  },
                });

              if (responseCount === 0) {
                return {
                  error: "NO_RESPONSES" as const,
                };
              }
            }

            // 6. Verify post-test before any updates
            if (phaseNumber === 5) {
              const postTest =
                await tx.assessment.findFirst({
                  where: {
                    moduleId:
                      session.assignment.moduleId,
                    type: "POST_TEST",
                    status: "PUBLISHED",
                  },
                  select: {
                    id: true,
                  },
                });

              if (!postTest) {
                return {
                  error:
                    "POST_TEST_NOT_AVAILABLE" as const,
                };
              }
            }

            // 7. Complete current phase
            const now = new Date();

            await tx.learningPhaseProgress.update({
              where: {
                id: currentPhase.id,
              },
              data: {
                status: "COMPLETED",
                completedAt: now,
              },
            });

            // ==========================================
            // PHASE 5: Complete learning session
            // and unlock post-test
            // ==========================================

            if (phaseNumber === 5) {
              const completedSession =
                await tx.learningSession.update({
                  where: {
                    id: session.id,
                  },
                  data: {
                    status: "COMPLETED",
                    completedAt: now,
                  },
                  select: {
                    id: true,
                    status: true,
                    currentPhase: true,
                    completedAt: true,
                    phases: {
                      orderBy: {
                        phaseNumber: "asc",
                      },
                      select: {
                        phaseNumber: true,
                        status: true,
                        startedAt: true,
                        completedAt: true,
                      },
                    },
                  },
                });

              await tx.studentModuleAssignment.update({
                where: {
                  id: session.assignment.id,
                },
                data: {
                  stage: "POST_TEST",
                },
              });

              return {
                session: completedSession,
                completedPhase: 5,
                unlockedPhase: null,
                nextStage: "POST_TEST" as const,
              };
            }

            // ==========================================
            // PHASES 1-4: Unlock next phase
            // ==========================================

            if (!nextPhase) {
              throw new Error(
                "Validated next phase is missing"
              );
            }

            await tx.learningPhaseProgress.update({
              where: {
                id: nextPhase.id,
              },
              data: {
                status: "ACTIVE",
                startedAt: now,
              },
            });

            const updatedSession =
              await tx.learningSession.update({
                where: {
                  id: session.id,
                },
                data: {
                  currentPhase: phaseNumber + 1,
                },
                select: {
                  id: true,
                  status: true,
                  currentPhase: true,
                  phases: {
                    orderBy: {
                      phaseNumber: "asc",
                    },
                    select: {
                      phaseNumber: true,
                      status: true,
                      startedAt: true,
                      completedAt: true,
                    },
                  },
                },
              });

            return {
              session: updatedSession,
              completedPhase: phaseNumber,
              unlockedPhase: phaseNumber + 1,
              nextStage: null,
            };
          },
          {
            maxWait: 5000,
            timeout: 10000,
          }
        );

        // 8. Handle expected errors
        if (result.error !== undefined) {
          const errors = {
            SESSION_NOT_FOUND: {
              status: 404,
              message: "Learning session not found",
            },
            SESSION_NOT_ACTIVE: {
              status: 409,
              message: "Learning session is not active",
            },
            WRONG_PHASE: {
              status: 409,
              message:
                "You can only complete the current phase",
            },
            PHASE_NOT_ACTIVE: {
              status: 409,
              message:
                "This learning phase is not active",
            },
            NEXT_PHASE_NOT_LOCKED: {
              status: 409,
              message:
                "The next learning phase is not locked",
            },
            NO_RESPONSES: {
              status: 409,
              message:
                "You must submit at least one response before completing this phase",
            },
            NO_SUBMISSION: {
              status: 409,
              message:
                "You must submit your structured phase answers before completing this phase",
            },
            POST_TEST_NOT_AVAILABLE: {
              status: 409,
              message:
                "A published post-test is required to complete the learning session",
            },
          };

          const error = errors[result.error];

          res.status(error.status).json({
            success: false,
            message: error.message,
          });
          return;
        }

        // 9. Return updated session
        res.status(200).json({
          success: true,
          message:
            result.completedPhase === 5
              ? "Learning session completed successfully"
              : "Learning phase completed successfully",
          data: {
            completedPhase: result.completedPhase,
            unlockedPhase: result.unlockedPhase,
            nextStage: result.nextStage,
            session: result.session,
          },
        });
      } catch (error) {
        console.error(
          "Failed to complete learning phase:",
          error
        );

        res.status(500).json({
          success: false,
          message:
            "Failed to complete learning phase",
        });
      }
    }
  );

export default router;